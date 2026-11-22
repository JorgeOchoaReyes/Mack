// The benchmark: a fixed set of formal problems Mack tries with the person's
// own settings, so a change of model, prover or attempt budget shows up as a
// solve rate instead of an impression. The labs report on these same sets
// (miniF2F, PutnamBench). A problem counts as solved only when the strict
// verifier accepts the proof, as in every other Mack run.

import { MINIF2F_TEST } from "./minif2f-test";

export type BenchProblem = { id: string; source: string };
export type BenchSet = { id: string; label: string; blurb: string; problems: BenchProblem[] };

export const BENCH_SETS: BenchSet[] = [
  {
    id: "minif2f-test",
    label: "miniF2F test",
    blurb: "244 competition problems (AIME, AMC, IMO, MATH) formalized in Lean 4: the set the labs' provers report on.",
    problems: MINIF2F_TEST,
  },
];

export const benchSet = (id: string): BenchSet | undefined => BENCH_SETS.find((s) => s.id === id);

export type BenchOutcome = "solved" | "failed" | "error" | "skipped";

export type BenchResult = {
  id: string;
  outcome: BenchOutcome;
  /** Model attempts made; 0 when Lean's automation closed it alone. */
  attempts: number;
  ms: number;
  usd: number;
  message?: string;
  proof?: string;
};

export type BenchConfig = {
  model: string;
  prover?: string;
  maxAttempts: number;
  parallel: number;
  automation: boolean;
  revisions: number;
};

export type BenchRun = {
  id: string;
  set: string;
  startedAt: number;
  finishedAt: number;
  status: "running" | "done" | "stopped";
  config: BenchConfig;
  /** The problems chosen, in the order they run. */
  sample: string[];
  results: BenchResult[];
  /** USD the whole run may spend; 0 means no limit beyond the global one. */
  budget: number;
  message?: string;
};

export type BenchEvent = { type: "started"; run: BenchRun } | { type: "status"; id: string; message: string } | { type: "result"; result: BenchResult } | { type: "finished"; run: BenchRun };

/** A string hash for a fixed order: the same set and size always picks the same problems, so runs compare. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** `n` problems of the set in a fixed pseudo-random order (a prefix of one order, so 20 is part of 50). */
export function pickSample(set: BenchSet, n: number): string[] {
  const order = [...set.problems].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
  return order.slice(0, Math.max(1, Math.min(n, order.length))).map((p) => p.id);
}

export type BenchSummary = { tried: number; solved: number; rate: number; usd: number; ms: number; byAutomation: number };

export function summarize(run: Pick<BenchRun, "results">): BenchSummary {
  const tried = run.results.filter((r) => r.outcome !== "skipped");
  const solved = tried.filter((r) => r.outcome === "solved");
  return {
    tried: tried.length,
    solved: solved.length,
    rate: tried.length ? solved.length / tried.length : 0,
    usd: run.results.reduce((a, r) => a + r.usd, 0),
    ms: run.results.reduce((a, r) => a + r.ms, 0),
    byAutomation: solved.filter((r) => r.attempts === 0).length,
  };
}

/**
 * Run each problem of the sample in turn with `proveOne`, reporting each
 * result. The run stops when `signal` aborts or the budget is spent; the
 * problems left are marked skipped, so a stopped run still reads honestly.
 */
export async function runBench(o: {
  run: BenchRun;
  set: BenchSet;
  proveOne: (p: BenchProblem, signal: AbortSignal) => Promise<BenchResult>;
  signal: AbortSignal;
  onEvent: (e: BenchEvent) => void;
}): Promise<BenchRun> {
  const run = o.run;
  o.onEvent({ type: "started", run });
  for (const id of run.sample) {
    const p = o.set.problems.find((x) => x.id === id);
    const spent = run.results.reduce((a, r) => a + r.usd, 0);
    const over = run.budget > 0 && spent >= run.budget;
    if (!p || o.signal.aborted || over) {
      const result: BenchResult = { id, outcome: "skipped", attempts: 0, ms: 0, usd: 0, message: !p ? "not in the set" : over ? "the run's budget is spent" : "stopped" };
      run.results.push(result);
      o.onEvent({ type: "result", result });
      continue;
    }
    o.onEvent({ type: "status", id, message: "starting" });
    let result: BenchResult;
    try {
      result = await o.proveOne(p, o.signal);
    } catch (e) {
      result = { id, outcome: "error", attempts: 0, ms: 0, usd: 0, message: (e as Error).message };
    }
    run.results.push(result);
    o.onEvent({ type: "result", result });
  }
  run.status = o.signal.aborted ? "stopped" : "done";
  run.finishedAt = Date.now();
  o.onEvent({ type: "finished", run });
  return run;
}
