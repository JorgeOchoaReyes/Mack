// What a finished headless benchmark run leaves behind (scripts/run-bench.ts,
// scripts/merge-bench.ts): its run.json in the scratch folder, and, only when
// it ran to the end, the run written as a share would (benchmarks/runs/<folder>/)
// with the pull request's body, ready for the workflow to open the PR. A run
// where Lean or the model never worked fails the job instead.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_SHARE_DIR, benchShare, benchSlug, ranToEnd, summarize, type BenchRun, type BenchSet } from "../core/bench/bench";
import { runSummary } from "../core/bench/summary";

/** Append Markdown to the GitHub Actions job summary, when there is one. */
export const jobSummary = (markdown: string) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
};

export function finishRun(run: BenchRun, set: BenchSet, appVersion: string, scratchRoot: string, prices?: string): void {
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
  let folder = "";
  let title = "";
  if (complete) {
    folder = benchSlug(run);
    const share = benchShare(run, set, appVersion, "", { logs: true });
    title = share.title;
    const dir = join(BENCH_SHARE_DIR, folder);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(share.files)) writeFileSync(join(dir, name), content);
    writeFileSync(join(scratchRoot, "pr-body.md"), share.body);
    console.log(`Written to ${dir}`);
  } else console.log("Not complete (stopped, a problem skipped, or a machine's part missing): nothing written for a pull request.");
  jobSummary(runSummary(run, "Benchmark run", { prices }));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\nfolder=${folder}\ntitle=${title.replace(/\n/g, " ")}\n`);
}
