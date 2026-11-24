// The benchmark: a fixed set of formal problems Mack tries with the person's
// own settings, so a change of model, prover or attempt budget shows up as a
// solve rate instead of an impression. The labs report on these same sets
// (miniF2F, PutnamBench). A problem counts as solved only when the strict
// verifier accepts the proof, as in every other Mack run.

import { MINIF2F_TEST } from "./minif2f-test";
import { PUTNAMBENCH } from "./putnambench";

export type BenchProblem = { id: string; source: string };
export type BenchSet = { id: string; label: string; blurb: string; problems: BenchProblem[] };

export const BENCH_SETS: BenchSet[] = [
  {
    id: "minif2f-test",
    label: "miniF2F test",
    blurb: "244 competition problems (AIME, AMC, IMO, MATH) formalized in Lean 4: the set the labs' provers report on.",
    problems: MINIF2F_TEST,
  },
  {
    id: "putnambench",
    label: "PutnamBench",
    blurb: `${PUTNAMBENCH.length} Putnam competition problems since 1962, formalized in Lean 4: much harder than miniF2F, and where the labs compete now. Answers are given; only the proofs are asked for.`,
    problems: PUTNAMBENCH,
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
  /** Why an unsolved problem failed (see FAILURES), from its attempts. */
  failure?: FailureKind;
  /** How the attempts ended, by outcome. */
  outcomes?: Record<string, number>;
  /** The last Lean feedback and the last candidate, cut short, to read why. */
  lastError?: string;
  lastCandidate?: string;
};

/** The reasons a benchmark problem goes unsolved, each with what would help. */
export const FAILURES = {
  names: { label: "Wrong lemma names", fix: "names Mathlib does not have: premise selection and the name lookup should help; a stronger prover model guesses fewer" },
  types: { label: "Type mismatch", fix: "terms of the wrong type, often casts between ℕ, ℤ and ℝ: push_cast/norm_cast hints, or a prover model" },
  gaps: { label: "Tactics did not close goals", fix: "the proof idea is right but steps stay open: decompose, more attempts, or easier versions first" },
  sorries: { label: "Gaps automation could not close", fix: "sorries left for automation were too hard: decompose turns each into a lemma of its own" },
  timeout: { label: "Lean timed out", fix: "heavy tactics (nlinarith, decide, simp on big terms): a longer Lean deadline or lighter proofs" },
  statement: { label: "Statement changed or forbidden", fix: "the attempts edited the theorem or used a banned shortcut: a prover model that follows the format" },
  rejected: { label: "Verifier rejected", fix: "Lean accepted the file but the verifier did not (sorry, axioms, a different type)" },
  split: { label: "Could not split", fix: "decompose's planner could not write steps Lean accepts, or a step's goal could not be stated as a lemma" },
  budget: { label: "Budget or stop", fix: "the run's budget or a stop ended it: a larger budget" },
  model: { label: "Model call failed", fix: "the provider refused or failed: the key, the model id or the provider's limits" },
  other: { label: "Other Lean errors", fix: "read the last error below" },
} as const;

export type FailureKind = keyof typeof FAILURES;

/** What one attempt left: its outcome and Lean's feedback. */
export type AttemptNote = { outcome: string; detail: string };

/** The likeliest reason a problem failed: the most common kind among its attempts, or what stopped the run. */
export function classifyFailure(attempts: AttemptNote[], message = ""): FailureKind {
  if (/budget|spending limit|cap reached|Stopped/i.test(message)) return "budget";
  if (!attempts.length) return /Model call failed/i.test(message) ? "model" : /split|steps/i.test(message) ? "split" : "other";
  const kindOf = (a: AttemptNote): FailureKind => {
    const d = a.detail;
    if (a.outcome === "no verdict" || /deadline|timeout|maximum recursion|heartbeats/i.test(d)) return "timeout";
    if (a.outcome === "refused") return "statement";
    if (a.outcome === "rejected") return "rejected";
    if (a.outcome === "sorries") return "sorries";
    if (/unknown (identifier|constant)|unknown namespace/.test(d)) return "names";
    if (/type mismatch|has type|failed to synthesize|application type mismatch/.test(d)) return "types";
    if (/unsolved goals|linarith failed|failed to prove|omega could not|nlinarith|positivity failed|simp made no progress|did not close/i.test(d)) return "gaps";
    return "other";
  };
  const counts = new Map<FailureKind, number>();
  for (const a of attempts) counts.set(kindOf(a), (counts.get(kindOf(a)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Unsolved problems by reason, most common first. */
export function failureBreakdown(results: BenchResult[]): { kind: FailureKind; count: number; ids: string[] }[] {
  const by = new Map<FailureKind, string[]>();
  for (const r of results) if ((r.outcome === "failed" || r.outcome === "error") && r.failure) by.set(r.failure, [...(by.get(r.failure) ?? []), r.id]);
  return [...by.entries()].map(([kind, ids]) => ({ kind, count: ids.length, ids })).sort((a, b) => b.count - a.count);
}

export type BenchConfig = {
  model: string;
  prover?: string;
  maxAttempts: number;
  parallel: number;
  automation: boolean;
  revisions: number;
  /** "single": attempts only; "decompose": attempts, then the statement split into lemmas. */
  method?: "single" | "decompose";
  easierFirst?: boolean;
  premises?: boolean;
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

const cut = (t: string | undefined, n: number) => (!t ? "" : t.length > n ? `${t.slice(0, n)}\n…` : t);

/**
 * A run as a Markdown report to share: the settings, the solve rate and cost,
 * the failures by reason, and for each unsolved problem its statement, how its
 * attempts ended, Lean's last feedback and the last attempt. Enough to see
 * where Mack loses problems without the app.
 */
export function benchReport(run: BenchRun, set: BenchSet | undefined, appVersion = ""): string {
  const sum = summarize(run);
  const c = run.config;
  const lines = [
    `# Mack benchmark: ${set?.label ?? run.set}, ${sum.solved}/${sum.tried} solved (${(sum.rate * 100).toFixed(1)}%)`,
    "",
    `- Run ${run.id}, ${new Date(run.startedAt).toISOString()}${appVersion ? `, Mack ${appVersion}` : ""}, ${run.status}`,
    `- Method: ${c.method ?? "single"}; model ${c.model}${c.prover ? `; prover ${c.prover}` : "; no prover model"}`,
    `- ${c.maxAttempts} attempts, ${c.parallel} at once, revisions before starting over ${c.revisions}; automation ${c.automation ? "on" : "off"}; premise selection ${c.premises ? "on" : "off"}; easier versions first ${c.easierFirst ? "on" : "off"}`,
    `- Spent $${sum.usd.toFixed(3)} in ${Math.round(sum.ms / 60000)} min; ${sum.byAutomation} solved by Lean's automation alone; budget ${run.budget ? `$${run.budget}` : "none"}`,
    "",
    "## Failures by reason",
    "",
  ];
  const breakdown = failureBreakdown(run.results);
  if (!breakdown.length) lines.push("None.");
  for (const b of breakdown) lines.push(`- **${FAILURES[b.kind].label}**: ${b.count} (${b.ids.join(", ")}). ${FAILURES[b.kind].fix}.`);
  const skipped = run.results.filter((r) => r.outcome === "skipped").length;
  if (skipped) lines.push(`- Skipped: ${skipped}`);
  lines.push("", "## Results", "", "| Problem | Outcome | Attempts | Time | Cost | Reason |", "|---|---|---|---|---|---|");
  for (const r of run.results) {
    lines.push(`| ${r.id} | ${r.outcome} | ${r.attempts} | ${Math.round(r.ms / 1000)}s | $${r.usd.toFixed(3)} | ${r.failure ? FAILURES[r.failure].label : r.outcome === "solved" && r.attempts === 0 ? "automation" : ""} |`);
  }
  const failed = run.results.filter((r) => r.outcome === "failed" || r.outcome === "error");
  if (failed.length) lines.push("", "## Unsolved problems");
  for (const r of failed) {
    const source = set?.problems.find((p) => p.id === r.id)?.source;
    lines.push("", `### ${r.id}: ${r.failure ? FAILURES[r.failure].label : r.outcome}`, "");
    if (r.outcomes) lines.push(`Attempts ended: ${Object.entries(r.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")}.`, "");
    if (r.message) lines.push(`Run message: ${cut(r.message, 400)}`, "");
    if (source) lines.push("Statement:", "```lean", cut(source.trim(), 1500), "```", "");
    if (r.lastError) lines.push("Lean's last feedback:", "```", cut(r.lastError, 1500), "```", "");
    if (r.lastCandidate) lines.push("Last attempt:", "```lean", cut(r.lastCandidate.trim(), 2500), "```");
  }
  return `${lines.join("\n")}\n`;
}

/** Where shared benchmark runs go in the Mack repo, one folder per run. */
export const BENCH_SHARE_DIR = "benchmarks/runs";

/** A folder name for a shared run: set, method and date. */
export function benchSlug(run: BenchRun): string {
  const d = new Date(run.startedAt).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${run.set}-${run.config.method ?? "single"}-${d}`;
}

/**
 * A run shared as a pull request on the Mack repo: the Markdown report and the
 * run's data (settings, model names and every problem's result; no keys), and
 * a PR with the headline numbers and the reasons, for review.
 */
export function benchShare(run: BenchRun, set: BenchSet | undefined, appVersion: string, contributor: string): { files: Record<string, string>; title: string; body: string } {
  const sum = summarize(run);
  const c = run.config;
  const models = `${c.model.split("/").pop()}${c.prover ? ` + ${c.prover.split(",").map((m) => m.trim().split("/").pop()).join(", ")}` : ""}`;
  const title = `Benchmark: ${set?.label ?? run.set} ${sum.solved}/${sum.tried} (${(sum.rate * 100).toFixed(0)}%), ${c.method ?? "single"}, ${models}`;
  const breakdown = failureBreakdown(run.results)
    .map((b) => `- ${FAILURES[b.kind].label}: ${b.count}`)
    .join("\n");
  const body = [
    `A benchmark run shared from Mack ${appVersion}${contributor ? ` by @${contributor}` : ""}, for review of where Mack loses problems.`,
    "",
    `- **${sum.solved}/${sum.tried} solved** (${(sum.rate * 100).toFixed(1)}%), ${sum.byAutomation} by Lean's automation alone; $${sum.usd.toFixed(2)} in ${Math.round(sum.ms / 60000)} min`,
    `- Method ${c.method ?? "single"}; model ${c.model}${c.prover ? `; prover ${c.prover}` : ""}; ${c.maxAttempts} attempts, ${c.parallel} at once`,
    "",
    "Unsolved, by reason:",
    breakdown || "- none",
    "",
    "The full report, with each unsolved problem's last attempt and Lean's feedback, is `REPORT.md` in this PR; `run.json` has the run's data.",
  ].join("\n");
  return { files: { "REPORT.md": benchReport(run, set, appVersion), "run.json": `${JSON.stringify(run, null, 2)}\n` }, title, body };
}
