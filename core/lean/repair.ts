// Mechanical repairs of a candidate that Lean rejects for reasons no prover
// should spend an attempt on. The only one so far: a tactic that runs after its
// goal is already closed ("No goals to be solved"), which a model often leaves
// behind a closing `simp` or `linarith`. The repaired file is checked again and
// kept only if Lean then reports fewer errors; the verifier still decides.

import type { LeanMessage } from "./check";

export const NO_GOALS = /^no goals( to be (solved|proved))?/i;

/** The candidate with each tactic Lean found nothing left for removed, or null when there is none to remove. */
export function dropDeadTactics(source: string, errors: LeanMessage[]): string | null {
  const dead = errors.filter((e) => NO_GOALS.test(e.message.trim()) && e.line > 0);
  if (!dead.length || dead.length !== errors.length) return null;
  const lines = source.split("\n");
  // From the last back, so earlier positions stay valid.
  for (const e of [...dead].sort((a, b) => b.line - a.line || b.col - a.col)) {
    const i = e.line - 1;
    const text = lines[i];
    if (text === undefined) return null;
    const head = text.slice(0, e.col);
    if (!head.trim()) lines.splice(i, 1);
    else lines[i] = head.replace(/\s*(<;>|;)\s*$/, "").replace(/\s+$/, "");
  }
  return lines.join("\n");
}
