import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LeanCheck } from "../core/lean/check";
import type { LeanRun } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import { failureReasons, readJournal, replay, RunManager, type RunStatus } from "../core/search/runs";
import { search, type JournalEntry, type SearchEvent } from "../core/search/search";
import { PlanBoard } from "../core/search/toolworker";

const FROZEN = "import Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n :=\nsorry\n";
let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mack-runs-"));
});
afterAll(async () => rm(dir, { recursive: true, force: true, maxRetries: 5 }));

const fakeRun: LeanRun = async (src) => {
  const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
  if (!marker) return { kind: "ok", output: "" };
  const ax = src.includes("by simp") ? "[propext]" : "[sorryAx]";
  return { kind: "ok", output: `${marker}\n'demo' depends on axioms: ${ax}\n@demo : ∀ (n : Nat), n + 0 = n\n` };
};
const fakeCheck = async (src: string): Promise<LeanCheck> =>
  src.includes("by simp") ? { status: "complete", errors: [], sorries: [], output: "" } : { status: "sorries", errors: [], sorries: [{ line: 4, col: 2, goal: "⊢ n + 0 = n" }], output: "" };

function scripted(f: (req: ChatRequest, i: number) => string): ModelProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return { name: "fake", requests, listModels: async () => [], chat: async (r) => (requests.push(r), { content: f(r, requests.length - 1) }) };
}

describe("plan board (upstream explore bounds)", () => {
  it("orders plans, shows only earlier ones after publishing, and refuses oversized or hidden text", () => {
    const b = new PlanBoard();
    b.publish("t1", { goal: "g1", approach: "induction", next_step: "base case" });
    const second = b.publish("t2", { goal: "g2", approach: "cases", next_step: "n = 0" });
    expect(second.earlier.map((p) => p.task)).toEqual(["t1"]);
    expect(b.read("t1").earlier).toEqual([]);
    // Publishing the same texts again changes nothing; changing them moves the plan behind.
    expect(b.publish("t1", { goal: "g1", approach: "induction", next_step: "base case" }).own?.revision).toBe(1);
    expect(b.publish("t1", { goal: "g1", approach: "strong induction", next_step: "base" }).earlier.map((p) => p.task)).toEqual(["t2"]);
    expect(() => b.publish("t3", { goal: "x".repeat(513), approach: "a", next_step: "b" })).toThrow("512");
    expect(() => b.publish("t3", { goal: "a‮b", approach: "a", next_step: "b" })).toThrow("control");
    b.release("t2");
    expect(b.read("t3").earlier.map((p) => p.task)).toEqual(["t1"]);
  });
});

describe("tool-loop workers", () => {
  it("work in their own workspace, publish plans, and hand over a verified file", async () => {
    const provider = scripted((r) => {
      const last = r.messages.at(-1)!.content;
      if (!last.includes("Tool results")) return '```tool\n{"name": "publish_plan", "args": {"goal": "prove it", "approach": "simp", "next_step": "try simp"}}\n```';
      if (last.includes("[publish_plan]"))
        return '```tool\n{"name": "write_file", "args": {"path": "demo.lean", "content": "import Mathlib\\n\\ntheorem demo (n : Nat) : n + 0 = n := by simp\\n"}}\n```\n```tool\n{"name": "write_file", "args": {"path": "STATE.md", "content": "# State\\nsimp closes it"}}\n```';
      if (last.includes("[write_file]")) return '```tool\n{"name": "submit", "args": {"name": "demo.lean"}}\n```';
      return "done";
    });
    const events: SearchEvent[] = [];
    const journal: JournalEntry[] = [];
    await search({
      frozen: FROZEN,
      problem: "demo",
      provider,
      model: "m",
      run: fakeRun,
      check: fakeCheck,
      limits: { w: 2, k1: 1, fanout: 2, callsPerContinuation: 6, modelCalls: 20 },
      worker: "tool",
      workspace: join(dir, "ws"),
      journal: (e) => journal.push(e),
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "solved")).toBe(true);
    const node = journal.find((e): e is Extract<JournalEntry, { kind: "node" }> => e.kind === "node")!;
    expect(node.node.task).toMatch(/^t\d{6}$/);
    expect(await readFile(join(dir, "ws", node.node.task!, "STATE.md"), "utf8")).toContain("simp closes it");
    // Two workers in one round got the plan tools; the second saw the first's plan.
    expect(provider.requests[0].messages[0].content).toContain("publish_plan");
    expect(journal.at(-1)).toEqual({ kind: "end", outcome: "solved" });
  });
});

describe("runs over problem sets", () => {
  it("journals each problem, groups failures, and resumes from the journal", async () => {
    let attempts = 0;
    const statuses: RunStatus[] = [];
    const runs = new RunManager(
      join(dir, "runs"),
      async ({ problem, workspace, resume, journal, onEvent, signal }) => {
        attempts++;
        await search({
          frozen: problem.frozen,
          problem: problem.id,
          // The first execution never solves; the resume does.
          provider: scripted(() => (attempts > 2 ? "```lean\nimport Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n := by simp\n```" : "```lean\nimport Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n := by\n  sorry\n```")),
          model: "m",
          run: fakeRun,
          check: fakeCheck,
          limits: { w: 1, k1: 2, fanout: 2, callsPerContinuation: 1, modelCalls: 2 },
          workspace,
          resume,
          journal,
          onEvent,
          signal,
        });
      },
      (s) => statuses.push(s),
    );
    runs.start({ name: "r1", project: "p", problems: [{ id: "a", frozen: FROZEN }, { id: "b", frozen: FROZEN }], limits: { w: 1, k1: 2, fanout: 2, callsPerContinuation: 1, modelCalls: 2 }, worker: "fixed", concurrency: 2, analysis: false });
    expect(() => runs.start({ name: "r1", project: "p", problems: [{ id: "a", frozen: FROZEN }], limits: { w: 1, k1: 1, fanout: 1, callsPerContinuation: 1, modelCalls: 1 }, worker: "fixed", concurrency: 1, analysis: false })).toThrow("already exists");
    await waitFor(() => statuses.length === 1);
    expect(statuses[0].problems.map((p) => p.state)).toEqual(["exhausted", "exhausted"]);
    expect(statuses[0].failureReasons[0].reason).toMatch(/^sorries/);
    const entries = readJournal(join(dir, "runs", "r1", "a", "journal.jsonl"));
    expect(replay(entries, FROZEN)).toMatchObject({ rounds: 2, calls: 2, end: "exhausted" });
    // Exhausted problems are done: a resume of an ended run has nothing left to run and ends at once.
    runs.resume("r1");
    await waitFor(() => statuses.length === 2);
    expect(statuses[1].problems.every((p) => p.state === "exhausted")).toBe(true);
    expect(runs.tree("r1", "a").length).toBe(3);
  });

  it("groups what keeps going wrong", () => {
    const n = (status: "errors" | "sorries", detail: string) => ({ id: 1, parent: 0, depth: 1, file: "", status, score: 0, detail, errors: 1, sorries: 0, continued: 0, round: 1, approach: "" });
    expect(failureReasons([n("errors", "  - line 3, column 2: error: unknown identifier 'foo'"), n("errors", "  - line 9, column 4: error: unknown identifier 'foo'")])).toEqual([
      { reason: "errors: - line ?: error: unknown identifier 'foo'", count: 2 },
    ]);
  });
});

async function waitFor(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
