// The run-wide lemma pool: helper lemmas from proofs already verified earlier
// in the same benchmark run, offered to the problems after them, as the
// strongest provers keep a pool of proved lemmas across a hard problem set.
// Each run keeps its own pool (runs compared on the same problems never share
// one), and only lemmas from proofs the strict verifier accepted go in.

import { words } from "../lean/mathlib-index";
import { extractStatement, theoremName } from "../lean/rules";
import type { Lemma } from "../prepare";

const MAX_LEMMA = 1500;

/** The helper lemmas of a verified proof of `frozen`: its top-level theorems and lemmas other than the problem's own, each with its proof. */
export function helperLemmas(proof: string, frozen: string, problemId: string): Lemma[] {
  const statement = extractStatement(frozen);
  const main = statement ? theoremName(statement) : undefined;
  const out: Lemma[] = [];
  // Top-level declarations start at column 0; each runs until the next line that does.
  const chunks = proof.split(/\n(?=\S)/);
  for (const c of chunks) {
    const m = /^(?:private\s+)?(?:theorem|lemma)\s+([^\s:({[]+)/.exec(c);
    if (!m || m[1] === main) continue;
    const source = c.trim();
    if (source.length > MAX_LEMMA || /\bsorry\b/.test(source)) continue;
    out.push({ file: `${problemId} (proved earlier in this run)`, source });
  }
  return out;
}

/** The `k` lemmas of the pool most related to a statement, by shared words; none share nothing. */
export function relevantLemmas(pool: Lemma[], frozen: string, k = 6): Lemma[] {
  const mine = new Set(words(extractStatement(frozen) ?? frozen));
  return pool
    .map((l, i) => {
      const theirs = new Set(words(l.source.split(":=")[0]));
      let shared = 0;
      for (const w of theirs) if (mine.has(w)) shared++;
      return { l, s: shared / (theirs.size || 1), i };
    })
    .filter((x) => x.s > 0.25)
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, k)
    .map((x) => x.l);
}
