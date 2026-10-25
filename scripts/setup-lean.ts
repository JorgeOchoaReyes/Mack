// `npm run setup:lean [workspace]`: the same setup the app's Setup screen runs.

import { DEFAULT_WORKSPACE, runSetup } from "../core/lean/setup";

const workspace = process.argv[2] ?? DEFAULT_WORKSPACE;
console.log(`Setting up Lean + Mathlib in ${workspace}`);
void runSetup(workspace, (e) => {
  if (e.type === "log") console.log(`  ${e.line}`);
  else console.log(`[${e.step}] ${e.state}${e.message ? `: ${e.message}` : ""}`);
}).then((ok) => {
  console.log(ok ? `\nDone. In Mack's Setup, the Lean workspace is ${workspace}` : "\nSetup failed; re-run to resume.");
  process.exit(ok ? 0 : 1);
});
