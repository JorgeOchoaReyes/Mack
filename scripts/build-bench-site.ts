// `node dist-electron/scripts/build-bench-site.js <out dir>`
// Builds the public benchmark site from benchmarks/runs/<folder>/run.json:
// the leaderboard and one page per run (core/bench/site.ts). A folder whose
// run.json is missing or unreadable is skipped with a warning, never fatal.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BENCH_SHARE_DIR } from "../core/bench/bench";
import { buildSite, withAttempts, type SharedRun } from "../core/bench/site";

const out = process.argv[2] ?? "_site";
const repo = `https://github.com/${process.env.GITHUB_REPOSITORY ?? "JorgeOchoaReyes/Mack"}`;

const runs: SharedRun[] = [];
if (existsSync(BENCH_SHARE_DIR)) {
  for (const folder of readdirSync(BENCH_SHARE_DIR)) {
    const dir = join(BENCH_SHARE_DIR, folder);
    if (!statSync(dir).isDirectory()) continue;
    try {
      const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as SharedRun;
      if (!Array.isArray(run.results) || !run.config || !run.set) throw new Error("not a benchmark run");
      const attempts = join(dir, "attempts.jsonl");
      runs.push(existsSync(attempts) ? withAttempts({ ...run, folder }, readFileSync(attempts, "utf8")) : { ...run, folder });
    } catch (e) {
      console.warn(`skipping ${dir}: ${(e as Error).message}`);
    }
  }
}

const files = buildSite(runs, repo);
for (const [path, html] of Object.entries(files)) {
  const file = join(out, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html, "utf8");
}
// GitHub Pages serves the files as they are, without Jekyll.
writeFileSync(join(out, ".nojekyll"), "");
console.log(`built ${Object.keys(files).length} pages from ${runs.length} runs into ${out}`);
