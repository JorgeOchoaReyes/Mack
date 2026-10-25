// The completion procedure of upstream's task-scoring protocol v3
// (`program-files/lean/src/completion.rs`, constants from `interfaces/lean`),
// Apache-2.0, on Mack's quick check (the resident REPL).
//
// `complete`: for each remaining `sorry`, in order, splice each tactic of the
// completion suite at that one `sorry` (`tac` in tactic position, `(by tac)`
// in term position), re-elaborate the whole file, and call it closed when
// there is no error and exactly one `sorry` fewer. When every `sorry` closes,
// the completed file goes to the strict verifier: the completion itself
// decides nothing.
//
// Upstream's other procedure, the sketch analysis, is core/lean/sketch.ts.
// Every elaboration is bounded; a failed one leaves the closers found so far
// and an `error`, never a fabricated verdict.

import type { LeanCheckRun } from "./check";

export const ANALYSIS_SUITE = ["assumption", "rfl", "trivial", "decide", "simp", "simp_all", "omega", "norm_num", "ring", "linarith", "positivity", "tauto", "aesop", "nlinarith"];
export const LIBRARY_SEARCH = "exact?";
export const ANALYSIS_HEARTBEATS = 50_000;
export const COMPLETION_SUITE = ["rfl", "assumption", "simp", "omega", "norm_num", "positivity", "decide", "linarith", "nlinarith", "ring", "simp_all", "aesop", "exact?"];
export const COMPLETION_HEARTBEATS = 100_000;

const sorryRe = /\bsorry\b/g;

/** Offsets of each `sorry` token outside comments and strings. */
export function sorryOffsets(src: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("--", i)) i = src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i);
    else if (src.startsWith("/-", i)) {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src.startsWith("/-", i)) (depth++, (i += 2));
        else if (src.startsWith("-/", i)) (depth--, (i += 2));
        else i++;
      }
    } else if (src[i] === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      sorryRe.lastIndex = i;
      const m = sorryRe.exec(src);
      const next = Math.min(...[src.indexOf("--", i), src.indexOf("/-", i), src.indexOf('"', i)].map((x) => (x === -1 ? src.length : x)));
      if (m && m.index < next) {
        out.push(m.index);
        i = m.index + 5;
      } else i = next;
    }
  }
  return out;
}

/** The file with `set_option maxHeartbeats N` after its imports, capping every declaration in it. */
function capped(src: string, heartbeats: number): string {
  const lines = src.split("\n");
  const last = lines.reduce((k, l, i) => (l.trim().startsWith("import ") ? i : k), -1);
  lines.splice(last + 1, 0, `set_option maxHeartbeats ${heartbeats}`);
  return lines.join("\n");
}

const splice = (src: string, at: number, len: number, text: string) => src.slice(0, at) + text + src.slice(at + len);

export type CompleteResult = { closers: { index: number; tactic: string }[]; completed?: string; error?: string };

/** Close every `sorry` with the completion suite, or report which closed. */
export async function complete(source: string, check: LeanCheckRun, opts: { wallMs?: number; maxSorries?: number } = {}): Promise<CompleteResult> {
  const offsets = sorryOffsets(source);
  const closers: CompleteResult["closers"] = [];
  if (!offsets.length || offsets.length > (opts.maxSorries ?? 6)) return { closers, error: offsets.length ? "too many sorries to try" : undefined };
  const base = await check(capped(source, COMPLETION_HEARTBEATS));
  if (base.status === "noVerdict" || base.status === "errors") return { closers, error: `the file does not check: ${base.status}` };
  const total = base.sorries.length;
  // The budget starts once Lean has the file: a cold first import of Mathlib is not the procedure's time.
  const deadline = Date.now() + (opts.wallMs ?? 120_000);
  let current = source;
  // Work from the last `sorry` back, so earlier offsets stay valid while splicing.
  for (let k = offsets.length - 1; k >= 0; k--) {
    const at = offsets[k];
    // Its position: `by sorry` parses where a term is expected, not where a tactic is.
    const probe = await check(capped(splice(current, at, 5, "by sorry"), COMPLETION_HEARTBEATS));
    const term = probe.status !== "errors";
    let closed = false;
    for (const tac of COMPLETION_SUITE) {
      if (Date.now() > deadline) return { closers, error: "completion ran out of time" };
      const text = term ? `(by ${tac})` : tac;
      const c = await check(capped(splice(current, at, 5, text), COMPLETION_HEARTBEATS));
      if (c.status === "noVerdict") return { closers, error: c.output };
      if (c.errors.length === 0 && c.sorries.length === total - closers.length - 1) {
        let used = text;
        if (tac === "exact?") {
          const suggestion = /Try this: (.+)/.exec(c.output)?.[1]?.trim();
          if (!suggestion) continue;
          used = term ? `(by ${suggestion})` : suggestion;
          const again = await check(capped(splice(current, at, 5, used), COMPLETION_HEARTBEATS));
          if (again.errors.length) continue;
        }
        current = splice(current, at, 5, used);
        closers.push({ index: k, tactic: used });
        closed = true;
        break;
      }
    }
    if (!closed) return { closers };
  }
  const final = await check(current);
  return final.status === "complete" ? { closers, completed: current } : { closers, error: `the completed file does not check: ${final.status}` };
}
