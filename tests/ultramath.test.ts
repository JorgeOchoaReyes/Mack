import { describe, expect, it } from "vitest";
import type { LeanCheck } from "../core/lean/check";
import type { LeanRun } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import { checkedLemmas, clean, declarations, parseActions, problemKind, ultramath, type UltramathEvent } from "../core/ultramath/swarm";

const FROZEN = "import Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n :=\nsorry\n";

describe("member protocol", () => {
  it("parses directions, posts, abandonment and submissions", () => {
    const a = parseActions(
      "<think>DIRECTION: hidden</think>Thinking.\nDIRECTION: induct on n\nPOST lemma: n + 0 = n by simp\nPOST dead end: rfl fails\nSUBMIT: done by simp\n```lean\ntheorem demo (n : Nat) : n + 0 = n := by simp\n```",
    );
    expect(a.direction).toBe("induct on n");
    expect(a.posts).toEqual([
      { kind: "lemma", text: "n + 0 = n by simp" },
      { kind: "dead end", text: "rfl fails" },
    ]);
    expect(a.submit).toBe("done by simp");
    expect(a.lean).toContain("by simp");
    expect(parseActions("ABANDON: too hard\nDIRECTION: try parity").abandon).toBe("too hard");
    expect(parseActions("SUBMIT: r\n```solution\nproof text\n```").solution).toBe("proof text");
  });

  it("strips hidden characters from member text", () => {
    expect(clean("a‮b​c\td\n")).toBe("abc\td");
  });

  it("tells problem kinds apart", () => {
    expect(problemKind(FROZEN)).toBe("lean");
    expect(problemKind("Prove that there are infinitely many primes.")).toBe("informal");
  });

  it("finds helper lemmas Lean accepted without sorry", () => {
    const file = "import Mathlib\n\nlemma a : True := trivial\n\nlemma b : True := by\n  sorry\n\ntheorem demo (n : Nat) : n + 0 = n := by\n  sorry\n";
    expect(declarations(file).map((d) => [d.name, d.start])).toEqual([
      ["a", 3],
      ["b", 5],
      ["demo", 8],
    ]);
    const check: LeanCheck = { status: "sorries", errors: [], sorries: [{ line: 6, col: 2, goal: "" }, { line: 9, col: 2, goal: "" }], output: "" };
    expect(checkedLemmas(file, check, "demo").map((l) => l.name)).toEqual(["a"]);
  });
});

/** A fake Lean that accepts exactly `by simp`. */
const run: LeanRun = async (src) => {
  const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
  if (!marker) return { kind: "ok", output: "" };
  const ax = src.includes("by simp") ? "[propext]" : "[sorryAx]";
  return { kind: "ok", output: `${marker}\n'demo' depends on axioms: ${ax}\n@demo : ∀ (n : Nat), n + 0 = n\n` };
};
const check = async (src: string): Promise<LeanCheck> =>
  src.includes("by simp")
    ? { status: "complete", errors: [], sorries: [], output: "" }
    : { status: "errors", errors: [{ line: 3, col: 0, message: "nope" }], sorries: [], output: "" };

/** Replies by who is asking: the duplicate checker, the judge, or member N (from its system prompt). */
function model(script: (who: string, turn: number, req: ChatRequest) => string): ModelProvider {
  const turns = new Map<string, number>();
  return {
    name: "fake",
    listModels: async () => [],
    chat: async (req) => {
      const sys = req.messages[0].content;
      const who = sys.startsWith("You decide whether") ? "dup" : sys.startsWith("You are the judge") ? "judge" : `m${/You are member (\d+)/.exec(sys)?.[1]}`;
      const t = (turns.get(who) ?? 0) + 1;
      turns.set(who, t);
      return { content: script(who, t, req) };
    },
  };
}

describe("Ultramath swarm", () => {
  it("refuses a duplicate direction and lets the verifier judge a Lean submission", async () => {
    const events: UltramathEvent[] = [];
    await ultramath({
      problem: FROZEN,
      provider: model((who, t) => {
        if (who === "dup") return "DUPLICATE: 1\nREASON: same induction";
        if (who === "m1") return t === 1 ? "DIRECTION: induction on n" : "SUBMIT: simp closes it\n```lean\nimport Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n := by simp\n```";
        return t === 1 ? "DIRECTION: also induction on n" : "DIRECTION: something else";
      }),
      model: "m",
      run,
      check,
      limits: { members: 2, rounds: 4, modelCalls: 20 },
      onEvent: (e) => events.push(e),
    });
    expect(events.find((e) => e.type === "refused")).toMatchObject({ member: 2, duplicateOf: 1 });
    expect(events.find((e) => e.type === "report")).toMatchObject({ member: 1, accepted: true });
    expect(events.at(-1)).toMatchObject({ type: "solved", n: 1 });
  });

  it("ends a direction after two rejections, and the judge decides informal problems", async () => {
    const events: UltramathEvent[] = [];
    let judged = 0;
    await ultramath({
      problem: "Show that 1 + 1 = 2.",
      provider: model((who, t) => {
        if (who === "judge") return ++judged < 3 ? "REJECT\nREASON: gap in step 2" : "ACCEPT\nREASON: fine";
        if (t === 1) return "DIRECTION: count";
        return "SUBMIT: by counting\n```solution\n1 + 1 = 2 by Peano.\n```";
      }),
      model: "m",
      limits: { members: 1, rounds: 6, modelCalls: 30 },
      onEvent: (e) => events.push(e),
    });
    const reports = events.filter((e) => e.type === "report");
    expect(reports.map((r) => r.type === "report" && r.accepted)).toEqual([false, false]);
    expect(events.find((e) => e.type === "direction" && e.direction.state === "died")).toBeDefined();
    // The member had to register again before it could submit a third time.
    expect(events.filter((e) => e.type === "turn" && e.summary.includes("did not register")).length).toBeGreaterThan(0);
  });
});
