import { describe, expect, it } from "vitest";
import { checkFromRun, describeCheck, parseCliOutput, type LeanCheck } from "../core/lean/check";
import { checkFromReply, splitHeader } from "../core/lean/repl";
import type { LeanRun } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import { search, type SearchEvent } from "../core/search/search";
import { admit, initialPolicy, scoreOf, SearchTree } from "../core/search/tree";

const FROZEN = "import Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n :=\nsorry\n";
const STATEMENT = "theorem demo (n : Nat) : n + 0 = n :=";

const root = () => new SearchTree({ file: FROZEN, status: "sorries", score: 0.5, detail: "", errors: 0, sorries: 1, approach: "" });
const child = (status: Parameters<typeof scoreOf>[0], extra: { errors?: number; sorries?: number } = {}) => ({
  file: "",
  status,
  score: scoreOf(status),
  detail: "",
  errors: extra.errors ?? 0,
  sorries: extra.sorries ?? 0,
  round: 1,
  approach: "",
});

describe("search tree (adapted from upstream discovery)", () => {
  it("scores by upstream's table", () => {
    expect([scoreOf("verified"), scoreOf("rejected"), scoreOf("sorries"), scoreOf("errors"), scoreOf("invalid")]).toEqual([1, 0.9, 0.5, 0.05, 0]);
  });

  it("starts with w copies of the root", () => {
    expect(initialPolicy(root(), 3, 2)).toEqual([0, 0, 0]);
  });

  it("prefers the best leaves, moves the most repairable errors node first and skips invalid ones", () => {
    const t = root();
    t.add(0, child("errors", { errors: 3 }));
    t.add(0, child("sorries", { sorries: 2 }));
    t.add(0, child("errors", { errors: 1 }));
    t.add(0, child("invalid"));
    t.add(0, child("sorries", { sorries: 1 }));
    t.nodes[0].continued = 5;
    expect(initialPolicy(t, 4, 2)).toEqual([3, 0, 5, 2]);
  });

  it("admits only continuable nodes within fan-out and tops up from the root", () => {
    const t = root();
    const a = t.add(0, child("sorries"));
    a.continued = 1;
    expect(admit(t, [a.id, a.id, 99], 3, 2)).toEqual([a.id, 0, 0]);
    t.add(a.id, child("errors"));
    // a is no longer a leaf
    expect(admit(t, [a.id], 2, 2)).toEqual([0, 0]);
  });

  it("follows a node's lineage back to the root", () => {
    const t = root();
    const a = t.add(0, child("sorries"));
    const b = t.add(a.id, child("sorries"));
    expect(t.lineage(b.id).map((n) => n.id)).toEqual([0, a.id, b.id]);
    expect(b.depth).toBe(2);
  });
});

describe("quick checks", () => {
  it("parses Lean's command-line errors and sorry warnings", () => {
    const out = "/tmp/P.lean:4:2: error: unknown identifier 'foo'\nmore text\n/tmp/P.lean:7:8: warning: declaration uses 'sorry'\n";
    const { errors, sorryLines } = parseCliOutput(out);
    expect(errors).toEqual([{ line: 4, col: 2, message: "unknown identifier 'foo'\nmore text" }]);
    expect(sorryLines).toEqual([7]);
    expect(checkFromRun({ kind: "refused", output: out }).status).toBe("errors");
    expect(checkFromRun({ kind: "ok", output: "/tmp/P.lean:7:8: warning: declaration uses 'sorry'\n" }).status).toBe("sorries");
    expect(checkFromRun({ kind: "noVerdict", reason: "deadline" }).status).toBe("noVerdict");
  });

  it("splits imports off and keeps line numbers", () => {
    const { header, body } = splitHeader("import Mathlib\nimport Aesop\n\ntheorem x : True := trivial\n");
    expect(header).toBe("import Mathlib\nimport Aesop");
    expect(body.split("\n")[3]).toBe("theorem x : True := trivial");
    expect(body.split("\n").slice(0, 2)).toEqual(["", ""]);
  });

  it("reads REPL replies, goals included", () => {
    const c = checkFromReply({
      env: 1,
      messages: [{ severity: "warning", pos: { line: 3, column: 8 }, data: "declaration uses 'sorry'" }],
      sorries: [{ pos: { line: 4, column: 2 }, goal: "n : ℕ\n⊢ n + 0 = n" }],
    });
    expect(c.status).toBe("sorries");
    expect(describeCheck(c)).toContain("⊢ n + 0 = n");
    expect(checkFromReply({ env: 2, messages: [{ severity: "error", pos: { line: 1, column: 0 }, data: "bad" }] }).status).toBe("errors");
    expect(checkFromReply({ message: "Unknown environment." }).status).toBe("errors");
  });
});

/** A Lean that knows two proofs: `simp` checks and verifies, anything else leaves a sorry. */
const fakeRun: LeanRun = async (src) => {
  const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
  const solved = src.includes(":=\nby simp") || src.includes(":= by simp");
  if (!marker) return { kind: "ok", output: "" };
  if (!solved && !src.includes("sorry")) return { kind: "refused", output: "P.lean:4:0: error: unsolved goals" };
  const axioms = solved || !src.includes("by\n") ? "'demo' depends on axioms: [propext]" : "'demo' depends on axioms: [sorryAx]";
  return { kind: "ok", output: `${marker}\n${axioms}\n@demo : ∀ (n : Nat), n + 0 = n\n` };
};
const fakeCheck = async (src: string): Promise<LeanCheck> =>
  src.includes("by simp")
    ? { status: "complete", errors: [], sorries: [], output: "" }
    : { status: "sorries", errors: [], sorries: [{ line: 4, col: 2, goal: "⊢ n + 0 = n" }], output: "" };

function scriptedModel(replies: string[]): ModelProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let i = 0;
  return {
    name: "fake",
    requests,
    chat: async (r) => {
      requests.push(r);
      return { content: replies[Math.min(i++, replies.length - 1)], usage: { promptTokens: 1, completionTokens: 10 } };
    },
    listModels: async () => [],
  };
}

describe("search loop", () => {
  it("builds on a partial proof and stops when the verifier accepts", async () => {
    const partial = "Approach: decompose\n```lean\nimport Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n := by\n  have h : True := trivial\n  sorry\n```";
    const full = "Approach: simp closes it\n```lean\nimport Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n := by simp\n```";
    const model = scriptedModel([partial, partial, full]);
    const events: SearchEvent[] = [];
    await search({
      frozen: FROZEN,
      provider: model,
      model: "m",
      run: fakeRun,
      check: fakeCheck,
      limits: { w: 1, k1: 4, fanout: 2, callsPerContinuation: 1, modelCalls: 10 },
      onEvent: (e) => events.push(e),
    });
    const nodes = events.filter((e) => e.type === "node");
    expect(nodes.map((n) => n.type === "node" && [n.node.id, n.node.parent, n.node.status])).toEqual([
      [1, 0, "sorries"],
      [2, 1, "sorries"],
      [3, 2, "verified"],
    ]);
    expect(events.at(-1)).toMatchObject({ type: "solved", n: 3 });
    // The third worker was shown node 2's file and its open goal.
    expect(model.requests[2].messages[0].content).toContain("continuing from node 2");
    expect(model.requests[2].messages[0].content).toContain("⊢ n + 0 = n");
    expect(STATEMENT).toBe("theorem demo (n : Nat) : n + 0 = n :=");
  });

  it("refuses a changed statement and stops at the call budget", async () => {
    const cheat = "```lean\nimport Mathlib\n\ntheorem demo (n : Nat) : True := by simp\n```";
    const events: SearchEvent[] = [];
    await search({
      frozen: FROZEN,
      provider: scriptedModel([cheat]),
      model: "m",
      run: fakeRun,
      check: fakeCheck,
      limits: { w: 2, k1: 5, fanout: 2, callsPerContinuation: 2, modelCalls: 4 },
      onEvent: (e) => events.push(e),
    });
    const nodes = events.filter((e) => e.type === "node");
    expect(nodes.length).toBe(2);
    expect(nodes.every((n) => n.type === "node" && n.node.status === "invalid")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "failed" });
  });
});

describe("partial credit", () => {
  it("gives closed have-steps credit over open sorries", async () => {
    const { partialScore } = await import("../core/search/tree");
    expect(partialScore(FROZEN, 1)).toBe(0.5);
    const file = "theorem demo (n : Nat) : n + 0 = n := by\n  have h1 : n = n := rfl\n  have h2 : True := by sorry\n  sorry\n";
    expect(partialScore(file, 2)).toBeCloseTo(0.5 + 0.4 / 3);
  });
});
