// Re-checks every solved proof of a shared run with Lean and the strict
// verifier, as CI does before a run is merged (scripts/recheck-bench.ts): a
// run.json can be edited by hand, so a solve counts on the site only when
// Lean accepts its proof again, here, against the run's own problem
// statement from Mack's copy of the set (never the run's copy of it).

import { benchSet, type BenchRun } from "./bench";
import { describeRejection, pristineType, verifyText, type LeanRun } from "../lean/verify";

export type Recheck = { id: string; ok: boolean; reason: string };

/** Each solved problem of `run`, re-verified; `jobs` at once. Unsolved problems are not checked: they claim nothing. */
export async function recheckRun(run: Pick<BenchRun, "set" | "results">, lean: LeanRun, jobs = 2, onDone?: (r: Recheck) => void): Promise<Recheck[]> {
  const set = benchSet(run.set);
  if (!set) return [{ id: "(run)", ok: false, reason: `unknown problem set "${run.set}"` }];
  const solved = run.results.filter((r) => r.outcome === "solved");
  const out: Recheck[] = [];
  let next = 0;
  const one = async (): Promise<void> => {
    while (next < solved.length) {
      const r = solved[next++];
      const problem = set.problems.find((p) => p.id === r.id);
      let res: Recheck;
      if (!problem) res = { id: r.id, ok: false, reason: `not a problem of ${set.label}` };
      else if (!r.proof) res = { id: r.id, ok: false, reason: "marked solved, with no proof" };
      else {
        try {
          const pristine = await pristineType(problem.source, lean);
          if (!pristine.ok) res = { id: r.id, ok: false, reason: `the statement does not check here: ${pristine.reason}` };
          else {
            const v = await verifyText(problem.source, pristine.type, r.proof, lean);
            res = v.ok ? { id: r.id, ok: true, reason: "" } : { id: r.id, ok: false, reason: describeRejection(v.rejection) };
          }
        } catch (e) {
          res = { id: r.id, ok: false, reason: `could not check: ${(e as Error).message}` };
        }
      }
      out.push(res);
      onDone?.(res);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, solved.length)) }, one));
  return solved.map((r) => out.find((x) => x.id === r.id)!).filter(Boolean);
}
