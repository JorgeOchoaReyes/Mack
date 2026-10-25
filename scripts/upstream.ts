// `npm run upstream`: what Open Math Harness changed in the methodology Mack
// follows since `baseline`, grouped by the Mack module each change maps to.
// `npm run upstream -- --accept` records the current upstream head as the new
// baseline in upstream.json: run it after porting, in the same commit.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkUpstream } from "../core/upstream";

async function main(): Promise<number> {
  const accept = process.argv.includes("--accept");
  const r = await checkUpstream();
  if (r.kind === "error") {
    console.error(`Could not check upstream: ${r.message}`);
    return 1;
  }
  if (r.kind === "current") {
    console.log(`Mack is aligned with upstream: no methodology changes since ${r.baseline.slice(0, 7)} (upstream head ${r.head.slice(0, 7)}).`);
    if (accept && r.head !== r.baseline) writeBaseline(r.head);
    return 0;
  }
  console.log(`${r.commits} upstream commit(s) since ${r.baseline.slice(0, 7)}; ${r.files.length} methodology file(s) changed.\n`);
  const byModule = new Map<string, typeof r.files>();
  for (const f of r.files) byModule.set(`${f.area} → ${f.mack}`, [...(byModule.get(`${f.area} → ${f.mack}`) ?? []), f]);
  for (const [module, files] of byModule) {
    console.log(module);
    for (const f of files) console.log(`  ${f.status.padEnd(9)} ${f.path}`);
  }
  console.log("\nRecent commits:");
  for (const c of r.recent) console.log(`  ${c.touchesWatched ? "*" : " "} ${c.sha.slice(0, 7)} ${c.message}`);
  console.log(`\nFull diff: ${r.compareUrl}`);
  if (accept) writeBaseline(r.head);
  else console.log("\nAfter porting, run `npm run upstream -- --accept` and commit upstream.json with the port.");
  return 0;
}

function writeBaseline(head: string): void {
  const file = join(__dirname, "..", "..", "upstream.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as { baseline: string };
  json.baseline = head;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`\nupstream.json baseline is now ${head.slice(0, 7)}. Update docs/UPSTREAM.md's module map if a status changed.`);
}

void main().then((code) => process.exit(code));
