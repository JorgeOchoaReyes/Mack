import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sweep, SWEEP_SUITE } from "../core/lean/analysis";
import type { LeanCheck } from "../core/lean/check";
import { describeExamples, ProofStore } from "../core/proof-store";
import { BENCH_SETS, mergeShards, pickSample, ranToEnd, runBench, shardOf, summarize, type BenchRun } from "../core/bench/bench";
import { freshRunScript, shq, sshArgs } from "../core/lean/remote";

const check = async (src: string): Promise<LeanCheck> => {
  // Only `aesop` closes `easy`; nothing closes `hard`; a probe `by sorry` put where a tactic goes, so it is an error.
  const bad = /by by sorry/.test(src) || /first \||grind|exact\?/.test(src) || /hard : B := by (?!sorry)/.test(src);
  if (bad) return { status: "errors", errors: [{ line: 1, col: 0, message: "no" }], sorries: [], output: "" };
  const n = (src.match(/\bsorry\b/g) ?? []).length;
  return { status: n ? "sorries" : "complete", errors: [], sorries: Array.from({ length: n }, () => ({ line: 1, col: 0, goal: "?" })), output: "" };
};

const FILE = `import Mathlib

theorem t : C := by
  have easy : A := by sorry
  have hard : B := by sorry
  exact foo easy hard
`;

describe("the automation sweep", () => {
  it("puts in what closes each sorry and leaves the rest, going on past one it cannot close", async () => {
    const r = await sweep(FILE, check);
    expect(r).toMatchObject({ closed: 1, open: 1 });
    expect(r.completed).toBeUndefined();
    expect(r.current).toContain("have easy : A := by aesop");
    expect(r.current).toContain("have hard : B := by sorry");
  });

  it("closes a file whose every sorry closes", async () => {
    const r = await sweep(FILE.replace(/  have hard.*\n/, ""), check);
    expect(r.completed).toContain("by aesop");
    expect(r.open).toBe(0);
  });

  it("tries the cheap closers in one call, each required to finish its goal, before the slower ones", () => {
    expect(SWEEP_SUITE[0]).toMatch(/^first \| \(rfl; done\) \| /);
    expect(SWEEP_SUITE.slice(1)).toEqual(["aesop", "grind", "exact?"]);
  });
});

describe("the store of verified proofs", () => {
  const frozen = (stmt: string) => `import Mathlib\n\ntheorem ${stmt} := by sorry\n`;

  it("offers the proofs of similar statements, never a statement's own", async () => {
    const store = new ProofStore(join(mkdtempSync(join(tmpdir(), "mack-proofs-")), "proofs.jsonl"));
    await store.add(frozen("sq_nonneg_add (a b : ℝ) : 0 ≤ a ^ 2 + b ^ 2"), "proof-1");
    await store.add(frozen("prime_two : Nat.Prime 2"), "proof-2");
    await store.add(frozen("prime_two : Nat.Prime 2"), "proof-2");
    expect(store.all()).toHaveLength(2);
    const near = store.similar(frozen("sq_nonneg_add3 (a b c : ℝ) : 0 ≤ a ^ 2 + b ^ 2 + c ^ 2"));
    expect(near.map((p) => p.proof)).toEqual(["proof-1"]);
    expect(store.similar(frozen("prime_two : Nat.Prime 2"))).toEqual([]);
    // A new store on the same file reads what was kept.
    expect(new ProofStore(store["file"]).all()).toHaveLength(2);
    expect(describeExamples(near)).toContain("proof-1");
    expect(describeExamples([])).toBe("");
  });
});

describe("the benchmark", () => {
  const set = BENCH_SETS[0];

  it("ships miniF2F's 244 test problems, each a frozen file proved by sorry", () => {
    expect(set.problems).toHaveLength(244);
    expect(set.problems.every((p) => p.source.startsWith("import Mathlib") && /:= by sorry\n$/.test(p.source))).toBe(true);
  });

  it("picks the same problems for the same size, a smaller run inside a larger one", () => {
    expect(pickSample(set, 20)).toEqual(pickSample(set, 20));
    expect(pickSample(set, 50).slice(0, 20)).toEqual(pickSample(set, 20));
    expect(new Set(pickSample(set, 244)).size).toBe(244);
  });

  it("runs each problem, skips the rest once the budget is spent, and counts the solve rate honestly", async () => {
    const run: BenchRun = { id: "1", set: set.id, startedAt: 0, finishedAt: 0, status: "running", config: { model: "m", maxAttempts: 1, parallel: 1, automation: true, revisions: 0 }, sample: pickSample(set, 4), results: [], budget: 1 };
    let k = 0;
    const done = await runBench({
      run,
      set,
      signal: new AbortController().signal,
      onEvent: () => {},
      proveOne: async (p) => (k++ === 0 ? { id: p.id, outcome: "solved", attempts: 0, ms: 5, usd: 0 } : { id: p.id, outcome: "failed", attempts: 3, ms: 5, usd: 1 }),
    });
    expect(done.results.map((r) => r.outcome)).toEqual(["solved", "failed", "skipped", "skipped"]);
    expect(summarize(done)).toMatchObject({ tried: 2, solved: 1, rate: 0.5, usd: 1, byAutomation: 1 });
    expect(done.status).toBe("done");
  });

  it("stops at once: the problem in progress is not waited for, and it and the rest count as skipped", async () => {
    const run: BenchRun = { id: "2", set: set.id, startedAt: 0, finishedAt: 0, status: "running", config: { model: "m", maxAttempts: 1, parallel: 1, automation: true, revisions: 0 }, sample: pickSample(set, 3), results: [], budget: 0 };
    const ctl = new AbortController();
    let seen: AbortSignal | undefined;
    const done = runBench({
      run,
      set,
      signal: ctl.signal,
      onEvent: () => {},
      // A problem that never finishes on its own, like a Lean check stuck for minutes.
      proveOne: (_p, signal) => {
        seen = signal;
        return new Promise(() => {});
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    ctl.abort();
    const finished = await done;
    expect(seen?.aborted).toBe(true);
    expect(finished.status).toBe("stopped");
    expect(finished.results.map((r) => r.outcome)).toEqual(["skipped", "skipped", "skipped"]);
    expect(finished.results.every((r) => r.message === "stopped")).toBe(true);
  });

  it("splits a run across machines and joins the parts into the same run over the whole sample", () => {
    const sample = pickSample(set, 7);
    const parts = [0, 1, 2].map((i) => shardOf(sample, i, 3));
    // Every problem in exactly one part, spread across them.
    expect(parts.flat().sort()).toEqual([...sample].sort());
    expect(parts.map((p) => p.length)).toEqual([3, 2, 2]);
    const base: BenchRun = { id: "x", set: set.id, startedAt: 0, finishedAt: 0, status: "done", config: { model: "m", maxAttempts: 1, parallel: 1, automation: true, revisions: 0 }, sample: [], results: [], budget: 1 };
    const part = (i: number, status: BenchRun["status"] = "done") => ({
      shard: i,
      shards: 3,
      sample,
      run: { ...base, startedAt: 10 + i, finishedAt: 100 + i, status, sample: parts[i], results: parts[i].map((id) => ({ id, outcome: "failed" as const, attempts: 1, ms: 1, usd: 0.5 })) },
    });
    const merged = mergeShards([part(2), part(0), part(1)]);
    expect(merged.results.map((r) => r.id)).toEqual(sample);
    expect(merged).toMatchObject({ status: "done", startedAt: 10, finishedAt: 102, budget: 3 });
    expect(ranToEnd(merged)).toBe(true);
    // A machine's part missing, or one stopped: not complete, so never shared.
    const lost = mergeShards([part(0), part(1)]);
    expect(lost.status).toBe("stopped");
    expect(lost.results.filter((r) => r.outcome === "skipped").map((r) => r.id)).toEqual(parts[2]);
    expect(ranToEnd(mergeShards([part(0), part(1, "stopped"), part(2)]))).toBe(false);
    // Parts of different runs are never joined.
    expect(() => mergeShards([part(0), { ...part(1), run: { ...part(1).run, config: { ...base.config, model: "other" } } }])).toThrow("different run");
  });

  it("counts as complete, for opening a PR on its own, only a run that gave every problem a result", () => {
    const sample = pickSample(set, 2);
    const base = { status: "done" as const, sample, results: sample.map((id) => ({ id, outcome: "failed" as const, attempts: 1, ms: 1, usd: 0 })) };
    expect(ranToEnd(base)).toBe(true);
    // Stopped early, or the budget ran out and the rest were skipped, or still going: never.
    expect(ranToEnd({ ...base, status: "stopped" })).toBe(false);
    expect(ranToEnd({ ...base, results: [base.results[0], { ...base.results[1], outcome: "skipped" }] })).toBe(false);
    expect(ranToEnd({ ...base, results: [base.results[0]] })).toBe(false);
    expect(ranToEnd({ ...base, status: "running" })).toBe(false);
  });
});

describe("Lean on another machine", () => {
  it("quotes the workspace for the remote shell and bounds each run there", () => {
    expect(shq("it's")).toBe(`'it'\\''s'`);
    const args = sshArgs({ host: "me@box", workspace: "~/my ws" }, "true");
    expect(args.slice(0, 2)).toEqual(["-T", "-o"]);
    expect(args).toContain("BatchMode=yes");
    expect(args[args.length - 2]).toBe("me@box");
    expect(args[args.length - 1]).toContain(`cd '~/my ws' && PATH="$HOME/.elan/bin:$PATH" && true`);
    expect(freshRunScript(29.2)).toContain("timeout 30 lake env lean");
  });
});

import { closeByAutomation } from "../core/lean/analysis";

describe("Lean's automation on a whole statement, in one Lean run", () => {
  const frozen = "import Mathlib\n\nset_option maxHeartbeats 400000\n\n/-- doc -/\ntheorem easy (x : ℕ) : x + 0 = x := by\n  sorry\n";
  it("checks every tactic of the sweep in a single run and returns the statement proved by the first that closes it", async () => {
    const files: string[] = [];
    const fake = async (src: string): Promise<LeanCheck> => {
      files.push(src);
      // Only the copy proved by `aesop` elaborates; every other copy errors on its own lines.
      const lines = src.split("\n");
      const errors = lines.flatMap((l, i) => (l.trim().startsWith("first |") || l.trim() === "grind" || l.trim() === "exact?" ? [{ line: i + 1, col: 2, message: "failed" }] : []));
      return { status: errors.length ? "errors" : "complete", errors, sorries: [], notes: [], output: "" };
    };
    const closed = await closeByAutomation(frozen, fake);
    expect(files).toHaveLength(1);
    expect(files[0].match(/theorem easy_mack_auto_\d/g)).toEqual(["theorem easy_mack_auto_0", "theorem easy_mack_auto_1", "theorem easy_mack_auto_2", "theorem easy_mack_auto_3"]);
    expect(closed).toBe("import Mathlib\n\nset_option maxHeartbeats 400000\n\n/-- doc -/\ntheorem easy (x : ℕ) : x + 0 = x := by\n  aesop\n");
  });

  it("returns nothing when no tactic closes it, or Lean gives no verdict", async () => {
    const allFail = async (src: string): Promise<LeanCheck> => ({ status: "errors", errors: src.split("\n").map((_, i) => ({ line: i + 1, col: 0, message: "no" })), sorries: [], output: "" });
    expect(await closeByAutomation(frozen, allFail)).toBeNull();
    expect(await closeByAutomation(frozen, async () => ({ status: "noVerdict", errors: [], sorries: [], output: "timeout" }))).toBeNull();
  });
});
