// The benchmark: a fixed set of formal problems Mack tries with the person's
// own settings, so a change of model, prover or attempt budget shows up as a
// solve rate instead of an impression. The labs report on these same sets
// (miniF2F, PutnamBench). A problem counts as solved only when the strict
// verifier accepts the proof, as in every other Mack run.

import { MINIF2F_TEST } from "./minif2f-test";
import { maskSecrets } from "../secrets";
import { PUTNAMBENCH } from "./putnambench";

export type BenchProblem = { id: string; source: string };
export type BenchSet = { id: string; label: string; blurb: string; problems: BenchProblem[] };

/** The latest Putnam years in PutnamBench, newest last: the recent set (below). */
export const RECENT_YEARS = (() => {
  const years = [...new Set(PUTNAMBENCH.map((p) => Number(/^putnam_(\d{4})_/.exec(p.id)?.[1] ?? 0)))].filter(Boolean).sort((a, b) => a - b);
  return years.slice(-2);
})();

/** The id of the recent set: published apart from the others, since its point is a different question. */
export const RECENT_SET = "putnam-recent";

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
  {
    id: RECENT_SET,
    label: `Recent Putnam (${RECENT_YEARS.join("–")})`,
    blurb: `The PutnamBench problems from the latest competitions (${RECENT_YEARS.join(" and ")}): the contamination check. Older problems and their proofs are public and may be in a model's training data; these are the least likely to be, for a model trained before they were set. A model that does much worse here than on older problems of the same difficulty was probably helped by memory.`,
    problems: PUTNAMBENCH.filter((p) => RECENT_YEARS.some((y) => p.id.startsWith(`putnam_${y}_`))),
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
  /** Every attempt, in order (each cut short), kept so a run can be analysed fairly, not from its last attempt alone. */
  log?: AttemptLog[];
  /** What the run did on this problem, in order: automation, splits, lemmas, status messages. */
  timeline?: { t: number; message: string }[];
};

/** One attempt as logged: who wrote it, how it ended, and what Lean said. */
export type AttemptLog = {
  n: number;
  outcome: string;
  kind: FailureKind | "verified";
  model?: string;
  /** When the model was asked (ISO time). */
  at?: string;
  ms: number;
  /** Completion tokens, and prompt tokens when the provider counts them. */
  tokens: number;
  promptTokens?: number;
  /** The reply stopped at the token limit, so the proof may be cut short. */
  truncated?: boolean;
  /** Lean's feedback (errors first), the candidate, the model's thinking and the prose around its proof. */
  detail: string;
  candidate: string;
  thinking?: string;
  prose?: string;
};

/** How many attempts, and how much of each, a problem's log keeps. */
export const LOG_LIMITS = { attempts: 60, detail: 1500, candidate: 3000, thinking: 6000, prose: 2000, timeline: 400, step: 2000 } as const;

/** A reply's thinking (`<think>` blocks, or what the provider sent apart) and the prose outside its last code block. */
export function splitReply(reply: string, reasoning?: string): { thinking: string; prose: string } {
  const think = [...reply.matchAll(/<think>([\s\S]*?)<\/think>/g)].map((m) => m[1].trim());
  const rest = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const blocks = [...rest.matchAll(/```[\s\S]*?```/g)];
  const last = blocks[blocks.length - 1];
  const prose = (last ? rest.slice(0, last.index) + rest.slice(last.index! + last[0].length) : rest).trim();
  return { thinking: [reasoning?.trim(), ...think].filter(Boolean).join("\n\n"), prose };
}

/** Where and how a run ran: Mack, the computer, Lean, and the settings that shape attempts beyond the config. */
export type BenchEnv = {
  app: string;
  platform: string;
  lean?: string;
  /** The Mathlib commit of the workspace the run used (its lake-manifest.json), so its proofs can be re-checked against the same Mathlib. */
  mathlib?: string;
  leanDeadlineMs: number;
  leanProcesses: number;
  repl: boolean;
  remoteLean: boolean;
  proofIdea: boolean;
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
  extra: { label: "Tactics after the goal was closed", fix: "a tactic ran after its goal was proved; Mack removes these itself from 0.2.19, so they should no longer cost attempts" },
  harness: { label: "Mack or Lean failed to run", fix: "not the model's doing: Lean could not start, crashed, or the connection to it dropped. Check Settings → Setup → Lean, or the remote machine" },
  budget: { label: "Budget or stop", fix: "the run's budget or a stop ended it: a larger budget" },
  model: { label: "Model call failed", fix: "the provider refused or failed: the key, the model id or the provider's limits" },
  other: { label: "Other Lean errors", fix: "read the last error below" },
} as const;

export type FailureKind = keyof typeof FAILURES;

/** What one attempt left: its outcome and Lean's feedback. */
export type AttemptNote = { outcome: string; detail: string };

/** The likeliest reason a problem failed: the most common kind among its attempts, or what stopped the run. */
/** Failures that are Mack's or the machine's, never the model's: Lean did not start, crashed, or its connection dropped. */
const HARNESS = /could not start|ENOENT|spawn|the REPL exited|unreadable REPL reply|ssh could not reach|was ended by SIG|killed|out of memory|ENOMEM/i;

/** The error messages in a check's output, without paths, warnings or notes; empty when it has none. */
export function errorMessages(detail: string): string {
  const out: string[] = [];
  let inError = false;
  for (const line of detail.split("\n")) {
    const head = /^\S*?:\d+:\d+:\s*(error|warning|info)(?:\([^)\s]*\))?:\s?(.*)$/.exec(line);
    if (head) {
      inError = head[1] === "error";
      if (inError) out.push(head[2]);
    } else if (inError) out.push(line);
  }
  return out.join("\n").trim();
}

/** Why one attempt failed, from its outcome and Lean's feedback. */
export function attemptKind(a: AttemptNote): FailureKind {
  // Only Lean's own errors judge an attempt: warnings and notes may mention anything.
  const errs = errorMessages(a.detail);
  const d = errs || a.detail;
  if (a.outcome === "no verdict") return HARNESS.test(a.detail) ? "harness" : "timeout";
  if (/exceeded the \d+ ms deadline|deterministic\) timeout|maximum recursion depth|maxHeartbeats/i.test(d)) return "timeout";
  if (a.outcome === "refused") return "statement";
  if (a.outcome === "rejected") return "rejected";
  if (a.outcome === "sorries") return "sorries";
  if (/unknown (identifier|constant)|unknown namespace/i.test(d)) return "names";
  if (/^\s*no goals( to be (solved|proved))?/im.test(d)) return "extra";
  if (/type mismatch|has type|failed to synthesize|application type mismatch/i.test(d)) return "types";
  if (/unsolved goals|linarith failed|failed to prove|omega could not|nlinarith|positivity failed|simp made no progress|did not close/i.test(d)) return "gaps";
  return "other";
}

export function classifyFailure(attempts: AttemptNote[], message = ""): FailureKind {
  if (/budget|spending limit|cap reached|Stopped/i.test(message)) return "budget";
  if (!attempts.length && HARNESS.test(message)) return "harness";
  if (!attempts.length) return /Model call failed/i.test(message) ? "model" : /split|steps/i.test(message) ? "split" : "other";
  const counts = new Map<FailureKind, number>();
  for (const a of attempts) counts.set(attemptKind(a), (counts.get(attemptKind(a)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Unsolved problems by reason, most common first. */
export function failureBreakdown(results: BenchResult[]): { kind: FailureKind; count: number; ids: string[] }[] {
  const by = new Map<FailureKind, string[]>();
  for (const r of results) if ((r.outcome === "failed" || r.outcome === "error") && r.failure) by.set(r.failure, [...(by.get(r.failure) ?? []), r.id]);
  return [...by.entries()].map(([kind, ids]) => ({ kind, count: ids.length, ids })).sort((a, b) => b.count - a.count);
}

export type BenchMethod = "single" | "decompose" | "steps" | "search" | "ultramath";

/** The methods, as the screen and the reports name them. */
export const METHOD_LABELS: Record<BenchMethod, string> = {
  single: "Attempts (Mack)",
  decompose: "Decompose into lemmas (Mack)",
  steps: "Step by step (Mack)",
  search: "Search tree (Open Math Harness)",
  ultramath: "Ultramath swarm (Open Math Harness)",
};

export type BenchConfig = {
  /** The provider of the main model, and of the prover models. */
  provider?: string;
  proverProvider?: string;
  model: string;
  prover?: string;
  maxAttempts: number;
  parallel: number;
  automation: boolean;
  revisions: number;
  /**
   * "single": attempts only; "decompose": attempts, then the statement split into lemmas (both Mack's);
   * "search": Open Math Harness's proof search tree; "ultramath": its swarm of members on a shared board.
   */
  method?: BenchMethod;
  easierFirst?: boolean;
  premises?: boolean;
  /** Helper lemmas from problems solved earlier in the run offered to later ones (core/bench/pool.ts). */
  lemmaPool?: boolean;
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
  /** Runs started together to compare models share a group, and each says which models it ran. */
  group?: string;
  label?: string;
  env?: BenchEnv;
  /** The harness the run used: Mack's version, the Open Math Harness commit it implements, and its own procedures in play. */
  harness?: BenchHarness;
  /** The pull request that shared the run on the Mack repo, once opened. */
  sharedPr?: { url: string; number: number; at: number; logs: boolean };
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
    `- Run ${run.id}, ${new Date(run.startedAt).toISOString()}, ${run.status}; run with Mack ${run.harness?.mack ?? run.env?.app ?? "(an earlier version, before runs recorded it)"}${appVersion ? `, report by Mack ${appVersion}` : ""}`,
    ...(run.env ? [`- Ran on ${run.env.platform}${run.env.lean ? `, ${run.env.lean}` : ""}; Lean REPL ${run.env.repl ? "on" : "OFF (every check reloaded Mathlib, so the run was several times slower)"}; Lean deadline ${Math.round(run.env.leanDeadlineMs / 1000)}s; ${run.env.leanProcesses} Lean processes${run.env.remoteLean ? " on a remote machine" : ""}`] : []),
    ...(run.harness ? [`- Harness: Mack ${run.harness.mack}, Open Math Harness ${run.harness.openMathHarness}; procedures: ${run.harness.procedures.join(", ")}`] : []),
    `- Method: ${METHOD_LABELS[c.method ?? "single"]}; model ${c.model}${c.prover ? `; prover ${c.prover}` : "; no prover model"}`,
    `- ${c.maxAttempts} attempts, ${c.parallel} at once, revisions before starting over ${c.revisions}; automation ${c.automation ? "on" : "off"}; premise selection ${c.premises ? "on" : "off"}; easier versions first ${c.easierFirst ? "on" : "off"}`,
    `- Spent $${sum.usd.toFixed(3)} in ${Math.round(sum.ms / 60000)} min; ${sum.byAutomation} solved by Lean's automation alone; budget ${run.budget ? `$${run.budget}` : "none"}`,
    "",
    "## Failures by reason",
    "",
  ];
  const basics = ["", "## How to read this report", "", ...BENCH_BASICS.map((b) => `- **${b.term}.** ${b.text}`)];
  const breakdown = failureBreakdown(run.results);
  if (!breakdown.length) lines.push("None.");
  for (const b of breakdown) lines.push(`- **${FAILURES[b.kind].label}**: ${b.count} (${b.ids.join(", ")}). ${FAILURES[b.kind].fix}.`);
  const skipped = run.results.filter((r) => r.outcome === "skipped").length;
  if (skipped) lines.push(`- Skipped: ${skipped}`);
  const kinds = attemptKinds(run);
  if (kinds.length) {
    const total = kinds.reduce((a, k) => a + k.count, 0);
    lines.push("", `## All ${total} attempts by how they ended`, "");
    for (const k of kinds) lines.push(`- ${k.kind === "verified" ? "Verified" : FAILURES[k.kind].label}: ${k.count} (${((k.count / total) * 100).toFixed(0)}%)`);
    const errs = topErrors(run);
    if (errs.length) {
      lines.push("", "## Commonest Lean errors", "", "| Error | Attempts | Problems |", "|---|---|---|");
      for (const e of errs) lines.push(`| ${e.error.replace(/\|/g, "\\|")} | ${e.count} | ${e.problems} |`);
    }
  }
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
  return `${[...lines, ...basics].join("\n")}\n`;
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
export function benchShare(run: BenchRun, set: BenchSet | undefined, appVersion: string, contributor: string, opts: { logs?: boolean } = {}): { files: Record<string, string>; title: string; body: string } {
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
    "The full report, with each unsolved problem's last attempt and Lean's feedback, is `REPORT.md` in this PR; `run.json` has the run's data. Once merged, the run appears on the benchmark site.",
  ].join("\n");
  const results = run.results.map(({ log, timeline, ...r }) => (opts.logs ? { ...r, ...(timeline ? { timeline } : {}) } : r));
  const shared = { ...run, results, ...(contributor ? { sharedBy: contributor } : {}), appVersion, attemptsLogged: !!opts.logs };
  const dataset = opts.logs ? attemptsDataset(run) : "";
  const raw: Record<string, string> = { "REPORT.md": benchReport(run, set, appVersion), "run.json": `${JSON.stringify(shared, null, 2)}\n`, ...(dataset ? { "attempts.jsonl": dataset } : {}) };
  // A model's thinking or Lean's output could quote a key: anything that looks like one is masked before it is published.
  const files = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, maskSecrets(v)]));
  return { files, title, body: dataset ? `${body}\n\n\`attempts.jsonl\` has every attempt (${dataset.trim().split("\n").length}): the model, how it ended, why, and Lean's feedback.` : body };
}

/** Lean's feedback without the file path or exit line, for reading and grouping. */
export function errorHead(detail: string): string {
  const line = detail
    .split("\n")
    .map((l) => l.replace(/^lean exited with \d+:\s*/, "").replace(/^\S*?:\d+:\d+:\s*(?:(?:error|warning|info)(?:\([^)\s]*\))?:\s*)?/, ""))
    .find((l) => l.trim());
  return (line ?? "").trim().slice(0, 200);
}

/**
 * The attempts of a run as a dataset: one JSON line per attempt, with the
 * problem, the model that wrote it, how it ended, why it failed, the first
 * line of Lean's feedback, the full (cut) feedback and the candidate. Every
 * attempt counts, so what a run did is measured, not guessed from its last try.
 */
export function attemptsDataset(run: BenchRun): string {
  const lines: string[] = [];
  for (const r of run.results) {
    for (const a of r.log ?? []) {
      lines.push(JSON.stringify({ run: run.id, set: run.set, method: run.config.method ?? "single", problem: r.id, solved: r.outcome === "solved", ...a, error: errorHead(a.detail) }));
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Attempts by kind across a run (verified ones included), most common first. */
export function attemptKinds(run: Pick<BenchRun, "results">): { kind: FailureKind | "verified"; count: number }[] {
  const counts = new Map<FailureKind | "verified", number>();
  for (const r of run.results) for (const a of r.log ?? []) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
}

/** The commonest first lines of Lean's feedback across a run: the errors that cost the most attempts. */
export function topErrors(run: Pick<BenchRun, "results">, limit = 15): { error: string; count: number; problems: number }[] {
  const by = new Map<string, { count: number; problems: Set<string> }>();
  for (const r of run.results)
    for (const a of r.log ?? []) {
      if (a.kind === "verified") continue;
      // Names and numbers vary between attempts; the message shape is what repeats.
      const key = errorHead(a.detail).replace(/`[^`]*`|'[^']*'/g, "`…`").replace(/\d+/g, "N");
      if (!key) continue;
      const e = by.get(key) ?? { count: 0, problems: new Set<string>() };
      e.count++;
      e.problems.add(r.id);
      by.set(key, e);
    }
  return [...by.entries()]
    .map(([error, e]) => ({ error, count: e.count, problems: e.problems.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export type ModelMetrics = { model: string; attempts: number; verified: number; completionTokens: number; promptTokens: number; ms: number; truncated: number };

export type RunMetrics = {
  solved: number;
  tried: number;
  rate: number;
  usd: number;
  perSolve: number | null;
  ms: number;
  msPerProblem: number;
  attempts: number;
  /** Attempts the solved problems took, on average: how quickly a model gets there. */
  attemptsPerSolve: number | null;
  byAutomation: number;
  promptTokens: number;
  completionTokens: number;
  msPerAttempt: number | null;
  truncated: number;
  /** Each model's share of the attempts and its verified ones (one model, or each of a prover ensemble). */
  byModel: ModelMetrics[];
  kinds: { kind: FailureKind | "verified"; count: number }[];
  failures: { kind: FailureKind; count: number; ids: string[] }[];
};

/** Everything a run's numbers say, from its results and its attempt log. */
export function runMetrics(run: Pick<BenchRun, "results">): RunMetrics {
  const s = summarize(run);
  const tried = run.results.filter((r) => r.outcome !== "skipped");
  const solved = tried.filter((r) => r.outcome === "solved");
  const logs = run.results.flatMap((r) => r.log ?? []);
  const models = new Map<string, ModelMetrics>();
  for (const a of logs) {
    const key = a.model ?? "unknown";
    const m = models.get(key) ?? { model: key, attempts: 0, verified: 0, completionTokens: 0, promptTokens: 0, ms: 0, truncated: 0 };
    m.attempts++;
    if (a.kind === "verified") m.verified++;
    m.completionTokens += a.tokens ?? 0;
    m.promptTokens += a.promptTokens ?? 0;
    m.ms += a.ms ?? 0;
    if (a.truncated) m.truncated++;
    models.set(key, m);
  }
  const attempts = tried.reduce((a, r) => a + r.attempts, 0);
  return {
    solved: s.solved,
    tried: s.tried,
    rate: s.rate,
    usd: s.usd,
    perSolve: s.solved ? s.usd / s.solved : null,
    ms: s.ms,
    msPerProblem: s.tried ? s.ms / s.tried : 0,
    attempts,
    attemptsPerSolve: solved.length ? solved.reduce((a, r) => a + r.attempts, 0) / solved.length : null,
    byAutomation: s.byAutomation,
    promptTokens: logs.reduce((a, l) => a + (l.promptTokens ?? 0), 0),
    completionTokens: logs.reduce((a, l) => a + (l.tokens ?? 0), 0),
    msPerAttempt: logs.length ? logs.reduce((a, l) => a + l.ms, 0) / logs.length : null,
    truncated: logs.filter((l) => l.truncated).length,
    byModel: [...models.values()].sort((a, b) => b.attempts - a.attempts),
    kinds: attemptKinds(run),
    failures: failureBreakdown(run.results),
  };
}

/**
 * The 95% Wilson interval of a solve rate: `k` solved of `n`. A rate from 20
 * problems is rough (13/20 is 43–82%), one from 244 much less so; the site
 * shows the range so two runs are only told apart when their ranges are.
 */
export function rateRange(k: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * A run's score as published: solved out of every problem in its sample, so a
 * problem skipped (budget spent, stopped) counts as unsolved and a run cannot
 * gain by stopping early. `full` when the sample is the whole set.
 */
export function publishedScore(run: Pick<BenchRun, "results" | "sample" | "set">): { solved: number; of: number; rate: number; low: number; high: number; full: boolean } {
  const of = run.sample.length || run.results.length;
  const solved = run.results.filter((r) => r.outcome === "solved").length;
  const { low, high } = rateRange(solved, of);
  const set = benchSet(run.set);
  return { solved, of, rate: of ? solved / of : 0, low, high, full: !!set && of === set.problems.length };
}

/** What is wrong with a run's sample: not the fixed one for its size, or results that are not exactly its problems. Empty when complete. */
export function sampleProblems(run: Pick<BenchRun, "results" | "sample" | "set">): string[] {
  const set = benchSet(run.set);
  if (!set) return [];
  const out: string[] = [];
  if (!Array.isArray(run.sample) || !run.sample.length) return ["run.json has no sample"];
  const expected = pickSample(set, run.sample.length);
  if (expected.length !== run.sample.length || expected.some((id, i) => run.sample[i] !== id)) out.push(`the sample is not the fixed ${run.sample.length} problems of ${set.label} that Mack picks for that size`);
  const ids = run.results.map((r) => r.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) out.push(`problems with more than one result: ${[...new Set(dup)].slice(0, 5).join(", ")}`);
  const missing = run.sample.filter((id) => !ids.includes(id));
  if (missing.length) out.push(`problems of the sample with no result (a skipped one is still listed, as skipped): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}`);
  const extra = ids.filter((id) => !run.sample.includes(id));
  if (extra.length) out.push(`results for problems outside the sample: ${extra.slice(0, 5).join(", ")}`);
  return out;
}

/** The attempt budgets "solved within k" is reported at. */
export const WITHIN = [1, 4, 16, 64] as const;

/**
 * How many problems were solved within k model attempts, for each k: a curve
 * like the labs' pass@k. Not the same measure: Mack's attempts revise one
 * another from Lean's feedback, where pass@k counts independent samples, so
 * the two are compared with that caveat. Automation alone counts as 0.
 */
export function solvedWithin(run: Pick<BenchRun, "results">, ks: readonly number[] = WITHIN): { k: number; solved: number }[] {
  const firsts = run.results.filter((r) => r.outcome === "solved").map((r) => r.attempts);
  return ks.map((k) => ({ k, solved: firsts.filter((n) => n <= k).length }));
}

/** Two runs head to head on the problems both tried: what each solved that the other did not. */
export function headToHead(a: Pick<BenchRun, "results">, b: Pick<BenchRun, "results">): { both: string[]; onlyA: string[]; onlyB: string[]; neither: string[] } {
  const outcome = (r: Pick<BenchRun, "results">) => new Map(r.results.filter((x) => x.outcome !== "skipped").map((x) => [x.id, x.outcome === "solved"]));
  const A = outcome(a);
  const B = outcome(b);
  const out = { both: [] as string[], onlyA: [] as string[], onlyB: [] as string[], neither: [] as string[] };
  for (const [id, sa] of A) {
    if (!B.has(id)) continue;
    const sb = B.get(id)!;
    (sa && sb ? out.both : sa ? out.onlyA : sb ? out.onlyB : out.neither).push(id);
  }
  return out;
}

/** One attempt as a timeline row: when (from the first attempt), who, what it cost, how it ended, and the earlier attempt it repeats. */
export type TimelineRow = AttemptLog & { label: string; offsetMs: number | null; error: string; repeats?: number };

/**
 * A problem's attempts in order. An attempt that fails with the same Lean
 * error as an earlier one (names and numbers aside) points back to it: a
 * model repeating one mistake is the clearest thing a timeline can show.
 */
export function timelineOf(r: Pick<BenchResult, "log">): TimelineRow[] {
  const log = [...(r.log ?? [])].sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : a.n - b.n));
  const t0 = log.find((a) => a.at)?.at;
  const seen = new Map<string, number>();
  return log.map((a) => {
    const error = a.kind === "verified" ? "" : errorHead(a.detail);
    const key = error.replace(/`[^`]*`|'[^']*'/g, "`…`").replace(/\d+/g, "N");
    const repeats = key ? seen.get(key) : undefined;
    if (key && repeats === undefined) seen.set(key, a.n);
    return {
      ...a,
      label: a.kind === "verified" ? "Verified" : FAILURES[a.kind].label,
      offsetMs: t0 && a.at ? Date.parse(a.at) - Date.parse(t0) : null,
      error,
      ...(repeats !== undefined ? { repeats } : {}),
    };
  });
}

/** How to read a benchmark run, in plain words: shown on the Benchmark screen, in every report and on the site. */
export const BENCH_BASICS: { term: string; text: string }[] = [
  { term: "Solved", text: "Lean's strict verifier accepted the proof: the statement is unchanged, no sorry or extra axiom is used, and Lean's kernel checks it. Nothing else counts, whatever the model says." },
  { term: "The problems", text: "miniF2F has 244 competition problems (AIME, AMC, IMO, MATH exercises); PutnamBench has Putnam problems since 1962 and is much harder. The same number of problems always picks the same ones, so runs compare." },
  { term: "Methods", text: "Attempts: the model writes whole proofs and fixes them from Lean's errors. Decompose: if that fails, the statement is split into lemmas that are proved separately and put back together. Step by step: the proof is built one tactic at a time on Lean's live proof states, keeping only steps Lean accepts." },
  { term: "Solve rate and cost", text: "In the app, solved problems out of those tried; on the public site, out of the whole sample, so a skipped problem counts as unsolved. Per solve is the run's whole cost divided by the problems solved. Cost, time and tokens are as the run reported them." },
  { term: "Attempts", text: "One attempt is one proof the model wrote and Lean checked. Attempts per solve is how many the solved problems took on average; fewer means the model gets there sooner." },
  { term: "By automation alone", text: "Problems Lean's own tactics (omega, simp, linarith, aesop, …) closed before any model call: free, and a floor every model starts from." },
  { term: "Why not solved", text: "Each failed attempt is labelled from Lean's errors: wrong lemma names, type mismatch, goals left open, timeouts, and so on. A problem's reason is its most common one; its timeline shows every attempt." },
  { term: "Range", text: "The 95% range of a solve rate: with few problems it is wide (13 of 20 is 43–82%), so two runs are only told apart when their ranges barely overlap. Only runs on the whole set are ranked." },
  { term: "Solved within k", text: "How many problems were solved within 1, 4, 16 or 64 model attempts. Like the labs' pass@k, but Mack's attempts learn from Lean's errors where pass@k samples independently, so compare with care." },
  { term: "Recent problems", text: "The latest Putnam competitions, as a contamination check: a model trained before they were set cannot have memorized their proofs. A big drop from older problems suggests memory helped there." },
  { term: "Mack's own failures", text: "If Lean could not start, crashed or lost its connection, the attempt is labelled \"Mack or Lean failed to run\", never blamed on the model. Many of these mean something to fix in Mack or the setup, not in the model." },
];

/**
 * Which harness produced a run, so runs from different harness versions are
 * never compared as if only the model changed: Mack's version, the Open Math
 * Harness commit its methodology follows, and the procedures of Mack's own
 * that the run used (each changes what a model can solve).
 */
export type BenchHarness = { mack: string; openMathHarness: string; procedures: string[] };

/** The harness of a run from its config: the always-on procedures, and the ones its settings turned on. */
export function harnessOf(config: BenchConfig, mack: string, openMathHarness: string): BenchHarness {
  // Open Math Harness's own searches use none of Mack's additions: only its verifier and Lean rules, as ported.
  if (config.method === "search") return { mack, openMathHarness: openMathHarness.slice(0, 7), procedures: ["strict verifier", "linters off", "OMH search tree"] };
  if (config.method === "ultramath") return { mack, openMathHarness: openMathHarness.slice(0, 7), procedures: ["strict verifier", "linters off", "OMH ultramath swarm"] };
  if (config.method === "steps") return { mack, openMathHarness: openMathHarness.slice(0, 7), procedures: ["strict verifier", "linters off", "step-by-step search", ...(config.automation ? ["automation on every state"] : []), ...(config.premises ? ["premise selection"] : [])] };
  const procedures = ["strict verifier", "linters off", "dead-tactic repair", "name repair"];
  if (config.automation) procedures.push("automation sweep");
  if (config.premises) procedures.push("premise selection");
  if (config.easierFirst) procedures.push("easier versions first");
  if (config.method === "decompose") procedures.push("decompose");
  if (config.prover) procedures.push(config.prover.includes(",") ? "prover ensemble" : "prover model");
  if (config.revisions) procedures.push(`restart after ${config.revisions} revisions`);
  if (config.lemmaPool) procedures.push("run-wide lemma pool");
  return { mack, openMathHarness: openMathHarness.slice(0, 7), procedures };
}

/** A harness in one line: `Mack 0.2.21 · OMH 687f2a2`. */
export const harnessLabel = (h: BenchHarness | undefined, app?: string) => (h ? `Mack ${h.mack} · OMH ${h.openMathHarness}` : app ? `Mack ${app}` : "");
