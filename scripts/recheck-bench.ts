// `node dist-electron/scripts/recheck-bench.js <lean workspace> <run folder …>`
// Re-verifies every solved proof of the given shared runs with Lean and the
// strict verifier (core/bench/recheck.ts), against the problem statements in
// Mack's own copy of the set. Exit code 1 when any proof is rejected, so a run
// whose solves do not hold is not merged. MACK_RECHECK_JOBS sets how many Lean
// processes run at once (default 2). A Markdown summary goes to
// $GITHUB_STEP_SUMMARY when set.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { BenchRun } from "../core/bench/bench";
import { recheckRun } from "../core/bench/recheck";
import { leanRunner } from "../core/lean/runner";

const [workspace, ...dirs] = process.argv.slice(2);
if (!workspace) {
  console.error("usage: recheck-bench <lean workspace> <run folder …>");
  process.exit(2);
}
const lean = leanRunner({ workspace, timeoutMs: 10 * 60_000 });
const jobs = Math.max(1, Number(process.env.MACK_RECHECK_JOBS) || 2);

void (async () => {
  const lines: string[] = ["## Solved proofs, re-checked with Lean", ""];
  let failed = 0;
  for (const dir of dirs) {
    if (!existsSync(join(dir, "run.json"))) continue;
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as BenchRun;
    const total = run.results.filter((r) => r.outcome === "solved").length;
    console.log(`${dir}: re-checking ${total} solved proofs (${jobs} at once)`);
    let done = 0;
    const checks = await recheckRun(run, lean, jobs, (r) => console.log(`  [${++done}/${total}] ${r.ok ? "ok  " : "FAIL"} ${r.id}${r.ok ? "" : `: ${r.reason.slice(0, 300)}`}`));
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) failed++;
    lines.push(`- ${bad.length ? "❌" : "✅"} \`${basename(dir)}\`: ${checks.length - bad.length} of ${checks.length} solved proofs accepted${run.env?.mathlib ? ` (Mathlib ${run.env.mathlib.slice(0, 10)})` : ""}`);
    for (const b of bad) lines.push(`  - \`${b.id}\`: ${b.reason.replace(/\n/g, " ").slice(0, 300)}`);
  }
  if (lines.length === 2) lines.push("No shared runs in this change.");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  console.log(failed ? `\n${failed} run(s) have solved proofs Lean rejects.` : "\nEvery solved proof holds.");
  process.exit(failed ? 1 : 0);
})();
