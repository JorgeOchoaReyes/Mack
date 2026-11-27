// What makes a shared benchmark run safe to merge into the Mack repo, where the
// site publishes it: only the files a share writes, a run.json the site can
// read whose problems belong to the set it names, sane sizes, and nothing that
// looks like a secret, and the whole fixed sample for its size (a failure
// cannot be dropped, a problem cannot be hand-picked). Whether each solved
// proof really holds is checked apart, with Lean (scripts/recheck-bench.ts).
// CI runs this on every pull request that adds a run
// (scripts/validate-bench.ts); a run that fails is not merged.

import { benchSet, sampleProblems, type BenchRun } from "./bench";
import { findings } from "../secrets";

/** The files a shared run holds; REPORT.md and run.json are required. */
export const RUN_FILES = ["REPORT.md", "run.json", "attempts.jsonl"] as const;
/** The most each file may weigh, in bytes. */
export const RUN_LIMITS: Record<(typeof RUN_FILES)[number], number> = { "REPORT.md": 5_000_000, "run.json": 10_000_000, "attempts.jsonl": 60_000_000 };

/** Every problem with a shared run, as a list of reasons; empty when the run may be merged. */
export function validateRun(folder: string, files: Record<string, string>, opts: { officialAllowed?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(folder)) problems.push(`the folder name "${folder}" is not lower-case letters, digits and dashes`);
  for (const name of Object.keys(files)) {
    if (!(RUN_FILES as readonly string[]).includes(name)) problems.push(`unexpected file ${name}: a shared run holds only ${RUN_FILES.join(", ")}`);
    else if (Buffer.byteLength(files[name], "utf8") > RUN_LIMITS[name as (typeof RUN_FILES)[number]]) problems.push(`${name} is larger than ${RUN_LIMITS[name as (typeof RUN_FILES)[number]] / 1e6} MB`);
  }
  for (const required of ["REPORT.md", "run.json"]) if (!(required in files)) problems.push(`missing ${required}`);
  // Nothing that looks like a key, token or password may be published.
  for (const [name, text] of Object.entries(files)) {
    const found = findings(text);
    if (found.length) problems.push(`${name} contains what looks like a secret (${found.slice(0, 3).map((f) => `${f.rule}: …${f.preview}…`).join("; ")})`);
  }
  if (!("run.json" in files)) return problems;
  let run: BenchRun;
  try {
    run = JSON.parse(files["run.json"]) as BenchRun;
  } catch (e) {
    return [...problems, `run.json is not JSON: ${(e as Error).message}`];
  }
  // Only the Mack repo's own workflow makes official runs; a pull request from a fork cannot claim one.
  if (run.official && !opts.officialAllowed) problems.push("run.json is marked official, but official runs come only from the Mack repo's benchmark workflow, not from a fork");
  if (run.official && !(/^https:\/\/github\.com\/JorgeOchoaReyes\/Mack\/actions\/runs\/\d+$/.test(String(run.official.url)) && typeof run.official.runner === "string" && run.official.runner.length <= 80))
    problems.push("an official run must link the Mack workflow run that made it (https://github.com/JorgeOchoaReyes/Mack/actions/runs/…)");
  const set = benchSet(run.set);
  if (!set) problems.push(`run.json names an unknown problem set "${run.set}"`);
  if (typeof run.config?.model !== "string" || !run.config.model) problems.push("run.json has no model");
  if (!Array.isArray(run.results) || !run.results.length) problems.push("run.json has no results");
  else if (set) {
    const ids = new Set(set.problems.map((p) => p.id));
    const bad = run.results.filter((r) => !ids.has(r.id)).map((r) => r.id);
    if (bad.length) problems.push(`results name problems that are not in ${set.label}: ${bad.slice(0, 5).join(", ")}`);
    const outcomes = run.results.filter((r) => !["solved", "failed", "error", "skipped"].includes(r.outcome));
    if (outcomes.length) problems.push(`results with an unknown outcome: ${outcomes.slice(0, 5).map((r) => r.id).join(", ")}`);
    // A solved problem carries the proof the verifier accepted, so anyone can check it.
    const noProof = run.results.filter((r) => r.outcome === "solved" && !r.proof).map((r) => r.id);
    if (noProof.length) problems.push(`solved problems without their proof: ${noProof.slice(0, 5).join(", ")}`);
    // Every problem of the fixed sample for the run's size, each once: no dropped failures, no hand-picked problems.
    problems.push(...sampleProblems(run));
  }
  if ("attempts.jsonl" in files) {
    const lines = files["attempts.jsonl"].split("\n").filter((l) => l.trim());
    const torn = lines.findIndex((l) => {
      try {
        JSON.parse(l);
        return false;
      } catch {
        return true;
      }
    });
    if (torn >= 0) problems.push(`attempts.jsonl line ${torn + 1} is not JSON`);
  }
  return problems;
}
