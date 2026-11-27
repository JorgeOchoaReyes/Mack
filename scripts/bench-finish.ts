// What a finished headless benchmark run leaves behind (scripts/run-bench.ts,
// scripts/merge-bench.ts): its run.json in the scratch folder, and, when every
// problem is listed, the run written as a share would (benchmarks/runs/<folder>/)
// with the pull request's body, ready for the workflow to open the PR. A run
// where Lean or the model never worked fails the job instead.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_SHARE_DIR, benchShare, benchSlug, ranToEnd, summarize, TRACE_DATASET, type BenchRun, type BenchSet } from "../core/bench/bench";
import { incompleteReason, runSummary } from "../core/bench/summary";

/** Append Markdown to the GitHub Actions job summary, when there is one. */
export const jobSummary = (markdown: string) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
};

/**
 * Every attempt's full trace, one file per problem (<out>/<problem>.jsonl, attempts in order), from the
 * traces-*.jsonl the machines wrote. Returns how many attempts were written; 0 when there are none.
 */
export function writeTraces(fromDir: string, out: string, problems: string[]): number {
  if (!fromDir || !existsSync(fromDir)) return 0;
  const wanted = new Set(problems);
  const by = new Map<string, { n: number; line: string }[]>();
  for (const f of readdirSync(fromDir).filter((x) => /^traces-\d+\.jsonl$/.test(x))) {
    for (const line of readFileSync(join(fromDir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const t = JSON.parse(line) as { problem?: string; n?: number };
        if (!t.problem || !wanted.has(t.problem)) continue;
        by.set(t.problem, [...(by.get(t.problem) ?? []), { n: Number(t.n) || 0, line }]);
      } catch {
        // A torn line (a machine stopped mid-write) is left out.
      }
    }
  }
  if (!by.size) return 0;
  mkdirSync(out, { recursive: true });
  let count = 0;
  for (const [problem, lines] of by) {
    writeFileSync(join(out, `${problem}.jsonl`), lines.sort((a, b) => a.n - b.n).map((x) => x.line).join("\n") + "\n");
    count += lines.length;
  }
  return count;
}

export function finishRun(run: BenchRun, set: BenchSet, appVersion: string, scratchRoot: string, prices?: string, tracesDir = ""): void {
  const sum = summarize(run);
  console.log(`\n${sum.solved}/${sum.tried} solved (${(sum.rate * 100).toFixed(1)}%), $${sum.usd.toFixed(2)}, ${Math.round(sum.ms / 60000)} min of problem time`);
  mkdirSync(scratchRoot, { recursive: true });
  writeFileSync(join(scratchRoot, "run.json"), JSON.stringify(run, null, 2));
  // A run where Lean or the model never worked measured nothing: never shared, and the job fails so it is seen.
  const broken = run.results.length > 0 && run.results.every((r) => r.outcome !== "solved" && (r.failure === "harness" || r.failure === "model" || r.outcome === "error"));
  if (broken) {
    jobSummary(runSummary(run, "Benchmark run", { prices, verdict: "❌ Every problem failed because Lean or the model could not run: check the model id and the API key. Nothing published." }));
    console.error("Every problem failed because Lean or the model could not run: check the workspace and the API key. Nothing written.");
    process.exit(1);
  }
  const complete = ranToEnd(run);
  // A pull request is opened for review whenever every problem of the sample is listed: a problem a spent budget
  // skipped counts as unsolved, which the site and CI accept. A run that was cut short opens as a draft that says why,
  // so it is never published without being read first. A machine's part that never arrived leaves problems unlisted:
  // nothing is written, since CI would refuse it.
  const listed = run.results.length === run.sample.length;
  const why = incompleteReason(run);
  let folder = "";
  let title = "";
  let traced = 0;
  if (listed) {
    folder = benchSlug(run);
    // The full traces go to a Hugging Face dataset (the workflow uploads them); the run names where, for the site to link.
    const dataset = (process.env.MACK_TRACES_DATASET ?? "").trim();
    if (dataset && TRACE_DATASET.test(dataset)) {
      traced = writeTraces(tracesDir, join(scratchRoot, "traces"), run.results.map((r) => r.id));
      if (traced) {
        run.traces = { dataset, path: `runs/${folder}` };
        console.log(`${traced} attempts' full traces written for ${dataset}/runs/${folder}`);
      }
    } else if (dataset) console.log(`MACK_TRACES_DATASET "${dataset}" is not owner/name: no traces published.`);
    const share = benchShare(run, set, appVersion, "", { logs: true });
    title = complete ? share.title : `[incomplete] ${share.title}`;
    const dir = join(BENCH_SHARE_DIR, folder);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(share.files)) writeFileSync(join(dir, name), content);
    writeFileSync(join(scratchRoot, "pr-body.md"), prBody(run, share.body, why, prices));
    console.log(`Written to ${dir}${complete ? "" : ` (incomplete: ${why})`}`);
  } else console.log(`Not every problem has a result (${why}): nothing written for a pull request.`);
  jobSummary(runSummary(run, "Benchmark run", { prices }));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\nlisted=${listed}\ntraces=${traced > 0}\nfolder=${folder}\ntitle=${title.replace(/\n/g, " ")}\n`);
}

/** The pull request's body: what to check, the whole run as a table, and the shared run's own summary. */
export function prBody(run: BenchRun, shareBody: string, why: string, prices?: string): string {
  return [
    why
      ? `> [!WARNING]\n> **Incomplete: ${why.replace(/\.$/, "")}.** Opened as a draft so the results can be read; merging publishes it with the skipped problems counted as unsolved.`
      : "> [!NOTE]\n> Opened for review. Merging publishes the run on the leaderboard; closing it publishes nothing.",
    "",
    "**Before merging:** the score and cost look right, the model is the one meant, and CI's *Benchmark runs* check (which re-verifies every solved proof with Lean) is green.",
    "",
    runSummary(run, "Results", { prices, verdict: why ? `⚠️ Incomplete: ${why}` : "✅ Every problem has a result." }),
    "",
    "---",
    "",
    shareBody,
  ].join("\n");
}
