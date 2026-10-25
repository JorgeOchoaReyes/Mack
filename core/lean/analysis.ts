// The two Lean-decided procedures of upstream's task-scoring protocol v3
// (`program-files/lean/src/completion.rs` and `sketch.rs`, constants from
// `interfaces/lean`), Apache-2.0, on Mack's quick check (the resident REPL).
//
// `complete`: for each remaining `sorry`, in order, splice each tactic of the
// completion suite at that one `sorry` (`tac` in tactic position, `(by tac)`
// in term position), re-elaborate the whole file, and call it closed when
// there is no error and exactly one `sorry` fewer. When every `sorry` closes,
// the completed file goes to the strict verifier: the completion itself
// decides nothing.
//
// `analyze` (simplified, so its records name `MACK_ANALYSIS_ID`, not
// upstream's suite id): closed steps are the `have`/`obtain … : T := proof`
// steps without `sorry`; a step is trivial when a tactic of the analysis
// suite, spliced in place of its proof, still elaborates, and unused when the
// name it binds never appears again (`this` and `_` count as used). A leaf
// (remaining `sorry`) is hollow when the frozen target follows, under the
// suite, from the theorem's binders plus the leaf's goal; a leaf whose goal
// mentions locals the sketch introduced, or that the suite refutes, is
// untestable and counts as open work. Upstream decides more in tactic mode
// (clearing locals, `Iff.mp`, re-linting); Mack's version is the textual one.
// Every elaboration is bounded; a failed one leaves the fields found so far
// and an `error`, never a fabricated verdict.

import type { LeanCheck, LeanCheckRun } from "./check";

export const ANALYSIS_SUITE = ["assumption", "rfl", "trivial", "decide", "simp", "simp_all", "omega", "norm_num", "ring", "linarith", "positivity", "tauto", "aesop", "nlinarith"];
export const LIBRARY_SEARCH = "exact?";
export const ANALYSIS_HEARTBEATS = 50_000;
export const COMPLETION_SUITE = ["rfl", "assumption", "simp", "omega", "norm_num", "positivity", "decide", "linarith", "nlinarith", "ring", "simp_all", "aesop", "exact?"];
export const COMPLETION_HEARTBEATS = 100_000;
export const MACK_ANALYSIS_ID = "mack-v3-text/S14+exact?/hb50000";

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

export type SketchAnalysis = {
  suite: string;
  closed: number;
  trivial: number;
  unused: number;
  leaves: number;
  hollow: number;
  untestable: number;
  error?: string;
};

/** The frozen statement's binders and target: `theorem name BINDERS : TARGET :=`. */
export function splitStatement(statement: string): { binders: string; target: string } | undefined {
  const m = /^\s*theorem\s+\S+/.exec(statement);
  if (!m) return undefined;
  const body = statement.slice(m[0].length).replace(/:=\s*$/, "");
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ("([{⦃".includes(c)) depth++;
    else if (")]}⦄".includes(c)) depth--;
    else if (c === ":" && depth === 0 && body[i + 1] !== "=") return { binders: body.slice(0, i).trim(), target: body.slice(i + 1).trim() };
  }
  return undefined;
}

type Step = { name: string; proofStart: number; proofEnd: number };

/** `have NAME : T := PROOF` steps whose proof holds no `sorry`: the proof runs to the next line at the step's indentation or less. */
export function closedSteps(src: string): Step[] {
  const lines = src.split("\n");
  const offsets: number[] = [];
  lines.reduce((o, l) => (offsets.push(o), o + l.length + 1), 0);
  const steps: Step[] = [];
  lines.forEach((l, i) => {
    const m = /^(\s*)(?:have|obtain)\s+([^\s:]*)\s*:[^\n]*?:=\s*/.exec(l);
    if (!m) return;
    const indent = m[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === "" || lines[end].search(/\S/) > indent)) end++;
    const proofStart = offsets[i] + m[0].length;
    const proofEnd = offsets[end - 1] + lines[end - 1].length;
    if (/\bsorry\b/.test(src.slice(proofStart, proofEnd))) return;
    steps.push({ name: m[2] || "this", proofStart, proofEnd });
  });
  return steps;
}

const goalTarget = (goal: string) => /⊢\s*([\s\S]+)$/.exec(goal)?.[1].trim();
const goalLocals = (goal: string) =>
  goal
    .split("\n")
    .filter((l) => !l.trim().startsWith("⊢") && l.includes(" : "))
    .flatMap((l) => l.split(" : ")[0].trim().split(/\s+/));

/** The textual sketch analysis of one `sorries` candidate. */
export async function analyze(source: string, frozenStatement: string, check: LeanCheckRun, opts: { wallMs?: number; maxSteps?: number } = {}): Promise<SketchAnalysis> {
  const r: SketchAnalysis = { suite: MACK_ANALYSIS_ID, closed: 0, trivial: 0, unused: 0, leaves: 0, hollow: 0, untestable: 0 };
  const first = await check(source);
  if (first.status !== "sorries") return { ...r, error: `the file is ${first.status}, not a partial proof` };
  r.leaves = first.sorries.length;
  const deadline = Date.now() + (opts.wallMs ?? 90_000);
  const header = source.split("\n").filter((l) => l.trim().startsWith("import ")).join("\n");
  const preamble = source.slice(0, Math.max(0, source.indexOf(frozenStatement)));
  const steps = closedSteps(source).slice(0, opts.maxSteps ?? 8);
  r.closed = steps.length;
  const errorsBefore = first.errors.length;
  for (const s of steps) {
    const rest = source.slice(s.proofEnd);
    if (s.name !== "this" && s.name !== "_" && !new RegExp(`(^|[^\\w.'])${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w']|$)`).test(rest)) {
      r.unused++;
      continue;
    }
    for (const tac of [...ANALYSIS_SUITE, LIBRARY_SEARCH]) {
      if (Date.now() > deadline) return { ...r, error: "the analysis ran out of time" };
      const c: LeanCheck = await check(capped(splice(source, s.proofStart, s.proofEnd - s.proofStart, `by ${tac}`), ANALYSIS_HEARTBEATS));
      if (c.status === "noVerdict") return { ...r, error: c.output };
      if (c.errors.length <= errorsBefore && c.sorries.length === first.sorries.length && !(tac === LIBRARY_SEARCH && !/Try this/.test(c.output))) {
        r.trivial++;
        break;
      }
    }
  }
  const parts = splitStatement(frozenStatement);
  const binderNames = parts ? [...parts.binders.matchAll(/[({[⦃]\s*([^:(){}[\]⦃⦄]+?)\s*:/g)].flatMap((m) => m[1].trim().split(/\s+/)) : [];
  for (const leaf of first.sorries) {
    const target = goalTarget(leaf.goal);
    const sketchLocals = goalLocals(leaf.goal).filter((n) => !binderNames.includes(n));
    if (!parts || !target || sketchLocals.some((n) => new RegExp(`(^|[^\\w.'])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w']|$)`).test(target))) {
      r.untestable++;
      continue;
    }
    const tactic = `first ${ANALYSIS_SUITE.map((t) => `| ${t}`).join(" ")}`;
    const test = (goal: string, hyp: string) =>
      `${header}\n${preamble.split("\n").filter((l) => !l.trim().startsWith("import ")).join("\n")}\nset_option maxHeartbeats ${ANALYSIS_HEARTBEATS} in\nexample ${parts.binders} ${hyp} : ${goal} := by ${tactic}\n`;
    if (Date.now() > deadline) return { ...r, error: "the analysis ran out of time" };
    // Vacuity control: from a false leaf everything follows, so the test would decide nothing.
    const refuted = await check(test(`¬ (${target})`, ""));
    if (refuted.status === "complete") {
      r.untestable++;
      continue;
    }
    const hollow = await check(test(parts.target, `(H : ${target})`));
    if (hollow.status === "noVerdict") return { ...r, error: hollow.output };
    if (hollow.status === "complete") r.hollow++;
  }
  return r;
}

/** Upstream's credit: 0.5 + 0.4 · C / (C + L), with C the closed steps that are neither trivial nor unused; 0.5 when any leaf is hollow. */
export function creditScore(a: SketchAnalysis): number {
  if (a.error && a.leaves === 0) return 0.5;
  if (a.hollow > 0) return 0.5;
  const c = Math.max(0, a.closed - a.trivial - a.unused);
  return c + a.leaves === 0 ? 0.5 : 0.5 + (0.4 * c) / (c + a.leaves);
}
