// `node dist-electron/scripts/verify-community.js <lean workspace> [entry folder …]`
// Checks community proofs with Mack's strict verifier: each entry's Proof.lean
// must prove its Statement.lean exactly, with no sorry and only standard
// axioms. With no entry folders it checks every entry. Exit code 1 when any
// entry fails. Writes a Markdown report to $GITHUB_STEP_SUMMARY when set.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { COMMUNITY_DIR, ENTRY_FILES } from "../core/community";
import { leanRunner } from "../core/lean/runner";
import { describeRejection, pristineType, verifyText } from "../core/lean/verify";

const [workspace, ...given] = process.argv.slice(2);
if (!workspace) {
  console.error("usage: verify-community <lean workspace> [entry folder …]");
  process.exit(2);
}
const run = leanRunner({ workspace, timeoutMs: 20 * 60_000 });
const all = existsSync(COMMUNITY_DIR) ? readdirSync(COMMUNITY_DIR).map((d) => join(COMMUNITY_DIR, d)).filter((d) => statSync(d).isDirectory()) : [];
const entries = [...new Set(given.length ? given : all)];

async function check(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null; // Removed by this change: nothing to check.
  const extra = readdirSync(dir).filter((f) => !(ENTRY_FILES as readonly string[]).includes(f));
  if (extra.length) return `unexpected files: ${extra.join(", ")} (an entry holds only ${ENTRY_FILES.join(", ")})`;
  for (const f of ["Statement.lean", "Proof.lean", "README.md"]) if (!existsSync(join(dir, f))) return `missing ${f}`;
  const frozen = readFileSync(join(dir, "Statement.lean"), "utf8");
  const proof = readFileSync(join(dir, "Proof.lean"), "utf8");
  if (!/\bsorry\b/.test(frozen)) return "Statement.lean must state the theorem proved by `sorry`";
  const pristine = await pristineType(frozen, run);
  if (!pristine.ok) return `the statement does not check: ${pristine.reason}`;
  const v = await verifyText(frozen, pristine.type, proof, run);
  return v.ok ? "" : describeRejection(v.rejection);
}

void (async () => {
  const rows: string[] = [];
  let failed = 0;
  for (const dir of entries) {
    const problem = await check(dir).catch((e: Error) => `could not check: ${e.message}`);
    if (problem === null) continue;
    const ok = problem === "";
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${dir}${ok ? "" : `: ${problem}`}`);
    rows.push(`| \`${basename(dir)}\` | ${ok ? "✅ accepted" : `❌ ${problem.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 400)}`} |`);
  }
  const report = rows.length ? ["## Community proofs", "", "| Entry | Strict verifier |", "|---|---|", ...rows, ""].join("\n") : "## Community proofs\n\nNo entries changed.\n";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  console.log(failed ? `\n${failed} of ${rows.length} entries failed.` : `\nAll ${rows.length} entries pass.`);
  process.exit(failed ? 1 : 0);
})();
