// A benchmark run as a GitHub Actions job summary (Markdown): what ran, how it
// went, and every problem's result. The cloud runs write one per machine and
// one for the whole run (scripts/run-bench.ts, scripts/bench-finish.ts).

import { benchSet, FAILURES, MODEL_ERROR_LIMIT, modelCalls, servedOthers, thinkingReturned, tooManyModelErrors, failureBreakdown, protocolLabel, publishedScore, ranToEnd, summarize, type BenchRun } from "./bench";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Why a finished run is not complete, in words; "" when it is. */
export function incompleteReason(run: BenchRun): string {
  if (ranToEnd(run)) return "";
  const skipped = run.results.filter((r) => r.outcome === "skipped");
  const missing = run.sample.length - run.results.length;
  if (run.status !== "done") return `the run was stopped or a machine's part is missing (${skipped.length} problem${skipped.length === 1 ? "" : "s"} without a result)`;
  if (missing > 0) return `${missing} problem${missing === 1 ? "" : "s"} without a result`;
  if (tooManyModelErrors(run)) {
    const { calls, errors } = modelCalls(run);
    return `${errors} of ${calls} model calls failed or timed out (${pct(errors / calls)}, above the ${pct(MODEL_ERROR_LIMIT)} limit), so the model had fewer real samples than the others: check the provider and run again`;
  }
  const budget = skipped.filter((r) => /budget/i.test(r.message ?? "")).length;
  return budget ? `the budget ran out: ${budget} problem${budget === 1 ? " was" : "s were"} skipped. Raise the budget and run again.` : `${skipped.length} problem${skipped.length === 1 ? " was" : "s were"} skipped`;
}

/** The run as Markdown: a headline, its settings, the failures by reason and a table of every problem. */
export function runSummary(run: BenchRun, title: string, opts: { prices?: string; pr?: string; verdict?: string } = {}): string {
  const set = benchSet(run.set);
  const sum = summarize(run);
  const score = publishedScore(run);
  const c = run.config;
  const why = incompleteReason(run);
  const lines = [
    `## ${title}`,
    "",
    `**${score.solved}/${score.of} solved (${pct(score.rate)})** · ${protocolLabel(run)} · $${sum.usd.toFixed(2)} · ${mins(sum.ms)} of problem time${sum.byAutomation ? ` · ${sum.byAutomation} by automation` : ""}`,
    "",
    opts.verdict ? `> ${opts.verdict}` : why ? `> ⚠️ Not complete: ${why}` : opts.pr ? `> ✅ Complete: ${opts.pr}` : "> ✅ Complete: every problem has a result.",
    "",
    "| Setting | Value |",
    "|---|---|",
    `| Set | ${cell(set?.label ?? run.set)}, ${run.sample.length} problems |`,
    `| Protocol | ${protocolLabel(run)}${c.protocol === "passk" ? " (independent samples, checked as written)" : `, ${c.method ?? "single"}`} |`,
    `| Model | ${cell(c.model)}${c.provider ? ` (${c.provider})` : ""} |`,
    ...(c.prover ? [`| Prover models | ${cell(c.prover)} |`] : []),
    `| Thinking | ${c.effort ?? "not set"} |`,
    ...(c.maxTokens ? [`| Reply limit | ${c.maxTokens} tokens |`] : []),
    ...(c.temperature !== undefined ? [`| Temperature | ${c.temperature} |`] : []),
    `| Attempts | ${c.maxAttempts} per problem, ${c.parallel} at once |`,
    `| Budget | ${run.budget ? `$${run.budget.toFixed(2)}` : "none"} |`,
    ...(opts.prices ? [`| Prices | ${cell(opts.prices)} |`] : []),
    ...(run.env ? [`| Machine | ${cell(run.env.platform)} |`] : []),
    ...(run.harness ? [`| Harness | Mack ${run.harness.mack} · OMH ${run.harness.openMathHarness} |`] : []),
  ];
  // What can still make a run compare unfairly, said in the PR so the reviewer sees it before merging.
  const { calls, errors } = modelCalls(run);
  const th = thinkingReturned(run);
  const others = servedOthers(run);
  lines.push(
    "",
    "**Fair comparison**",
    "",
    errors ? `- ${tooManyModelErrors(run) ? "⚠️" : "✅"} Model calls: ${errors} of ${calls} failed or timed out (${pct(errors / calls)}; limit ${pct(MODEL_ERROR_LIMIT)})` : `- ✅ Model calls: all ${calls} answered`,
    ...(c.effort && th.replies ? [th.withThinking ? `- ✅ Thinking at ${c.effort}: returned on ${th.withThinking} of ${th.replies} replies` : `- ⚠️ Thinking at ${c.effort}: none came back on ${th.replies} replies; the model may ignore the level`] : []),
    others.length ? `- ⚠️ Served model: ${others.map((o) => `${cell(o.model)} on ${o.count}`).join(", ")}, not ${cell(c.model)}` : "- ✅ Served model: the one asked for, wherever the provider reported it",
  );
  const breakdown = failureBreakdown(run.results);
  if (breakdown.length) lines.push("", "**Why problems were not solved**", "", ...breakdown.map((b) => `- ${FAILURES[b.kind].label}: ${b.count}`));
  lines.push(
    "",
    "<details><summary>Every problem</summary>",
    "",
    "| Problem | Result | Attempts | Time | Cost | Why |",
    "|---|---|---|---|---|---|",
    ...run.results.map((r) => `| ${r.id} | ${r.outcome === "solved" ? (r.attempts === 0 ? "✅ automation" : "✅ solved") : r.outcome === "skipped" ? "⏭️ skipped" : "❌ " + r.outcome} | ${r.attempts} | ${mins(r.ms)} | $${r.usd.toFixed(3)} | ${cell(r.failure ? FAILURES[r.failure].label : (r.message ?? "").slice(0, 80))} |`),
    "",
    "</details>",
    "",
  );
  return lines.join("\n");
}
