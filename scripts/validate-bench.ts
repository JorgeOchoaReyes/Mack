// `node dist-electron/scripts/validate-bench.js [run folder …]`
// Checks shared benchmark runs (benchmarks/runs/<folder>/) before they are
// merged and published on the site: core/bench/validate.ts. With no folders it
// checks every run. Exit code 1 when any fails; a Markdown summary goes to
// $GITHUB_STEP_SUMMARY when set.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { BENCH_SHARE_DIR } from "../core/bench/bench";
import { validateRun } from "../core/bench/validate";

const given = process.argv.slice(2);
const all = existsSync(BENCH_SHARE_DIR) ? readdirSync(BENCH_SHARE_DIR).map((d) => join(BENCH_SHARE_DIR, d)).filter((d) => statSync(d).isDirectory()) : [];
const dirs = [...new Set(given.length ? given : all)].filter((d) => existsSync(d));

const lines: string[] = ["## Shared benchmark runs", ""];
let failed = 0;
for (const dir of dirs) {
  const files: Record<string, string> = {};
  for (const f of readdirSync(dir)) if (statSync(join(dir, f)).isFile() && f !== ".gitkeep") files[f] = readFileSync(join(dir, f), "utf8");
  const problems = validateRun(basename(dir), files);
  if (problems.length) {
    failed++;
    lines.push(`- ❌ \`${basename(dir)}\``, ...problems.map((p) => `  - ${p}`));
    console.error(`${dir}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  } else {
    lines.push(`- ✅ \`${basename(dir)}\``);
    console.log(`${dir}: ok`);
  }
}
if (!dirs.length) lines.push("No shared runs in this change.");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
process.exit(failed ? 1 : 0);
