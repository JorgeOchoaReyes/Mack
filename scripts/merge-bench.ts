// `node dist-electron/scripts/merge-bench.js --scratch <dir> <shard-0.json> <shard-1.json> …`
// Joins the parts of a benchmark run split across machines (run-bench.js
// --shard/--shards) into one run over the whole sample, then finishes it as a
// single run would (scripts/bench-finish.ts): shared only when every problem
// has a result.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { benchSet, mergeShards, type BenchShard } from "../core/bench/bench";
import { finishRun } from "./bench-finish";

const argv = process.argv.slice(2);
const at = argv.indexOf("--scratch");
const scratch = at >= 0 ? argv[at + 1] : "";
const files = argv.filter((_, k) => k !== at && k !== at + 1);
if (!scratch || !files.length) {
  console.error("usage: merge-bench --scratch <dir> <shard.json …>");
  process.exit(2);
}
const parts = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as BenchShard);
const run = mergeShards(parts);
const set = benchSet(run.set);
if (!set) {
  console.error(`unknown set ${run.set}`);
  process.exit(2);
}
console.log(`Merged ${parts.length} of ${parts[0].shards} parts: ${run.results.filter((r) => r.outcome !== "skipped").length}/${run.sample.length} problems with a result.`);
if (run.env) run.env = { ...run.env, platform: `${parts[0].shards} machines in parallel, each ${run.env.platform}` };
const appVersion = run.env?.app ?? (JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string }).version;
finishRun(run, set, appVersion, scratch);
process.exit(0);
