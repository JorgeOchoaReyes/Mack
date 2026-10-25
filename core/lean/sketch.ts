// `analyze`: the sketch analysis of task-scoring protocol v3, ported from
// open-math-harness `program-files/lean/src/sketch.rs` (Apache-2.0), with
// its constants from `interfaces/lean`. The procedure is part of the
// protocol, so every detail below is deliberate and follows upstream; the
// records name upstream's suite id because it is the same procedure.
//
// On the resident REPL, for one `sorries` candidate:
//
// 1. the candidate (header imports blanked, positions its own) is elaborated
//    once for real — the status, and the environment `env1` in which the
//    theorem and its auxiliaries (`match_N`, …) exist;
// 2. a renamed copy (`<thm>_sketch`, padded so its positions are the
//    candidate's) is elaborated in `env1` with `allTactics`, because the REPL
//    builds a tactic's proof state in the environment before the command:
//    the copy's states see the theorem's own auxiliaries and the verbatim
//    frozen target elaborates in them (a restatement is caught);
// 3. closed steps are the maximal sorry-free `have`/`obtain … : T := …`
//    tactics and `·` blocks; each is trivial when a tactic of
//    `ANALYSIS_SUITE` (in order, under `ANALYSIS_HEARTBEATS`) or the library
//    search closes its statement from its context, and unused when Lean's
//    unused-variable linter, on a copy whose sorries are an analysis-only
//    axiom `leaf_hole`, reports every name it binds (unused steps become
//    `skip` and the copy is re-linted, at most `LINT_ROUNDS` times; `this`
//    and `_` count as used);
// 4. each leaf (remaining `sorry`) is hollow when the frozen target follows
//    from the leaf's statement under the suite: sketch-introduced locals are
//    cleared newest first (what `clear` refuses is reverted into the
//    statement), then `Iff.mp` against the verbatim frozen target opens the
//    goal `H : <leaf> ⊢ <frozen target>` for the suite; when the frozen
//    target no longer elaborates in the leaf the closed leaf statement is
//    re-elaborated as text beside the frozen theorem instead (the
//    pretty-printer options of `PP_OPTIONS` make printed goals re-parse); a
//    leaf whose goal is not a proposition is untestable, and so is one whose
//    stripped statement proves anything (the vacuity control).
//
// Failure: a REPL death or the wall-clock backstop `ANALYZE_WALL_MS` ends the
// analysis with `error` set and the fields obtained so far kept, never a
// fabricated verdict. The analysis-only environments (`leaf_hole`, the
// renamed copies) are children of `env1` that nothing else ever sees.

import { ANALYSIS_HEARTBEATS, ANALYSIS_SUITE, LIBRARY_SEARCH } from "./analysis";
import { splitHeader, type RawCommand, type RawMessage, type RawTactic, type ReplSession } from "./repl";
import { extractStatement, theoremName } from "./rules";

export const ANALYSIS_SUITE_ID = "v3-S14+exact?/hb50000";
export const ANALYZE_WALL_MS = 120_000;
export const LINT_ROUNDS = 4;
export const PP_OPTIONS =
  "set_option pp.funBinderTypes true\nset_option pp.coercions.types true\nset_option pp.showLetValues true\nset_option pp.mathlib.binderPredicates false";
const LINT_ENV = "set_option linter.unusedVariables.analyzeTactics true\naxiom leaf_hole.{u} {α : Sort u} : α";
const NOTE_CHARS = 160;
export const MAX_ANALYSIS_ITEMS = 64;
export const MAX_ANALYSIS_TEXT_CHARS = 2000;
const VACUITY_CONTROL = "exfalso; apply Nat.zero_ne_one; ";

export type StepKind = "have" | "obtain" | "bullet";
export type Step = {
  kind: StepKind;
  line: number;
  column: number;
  name?: string;
  statement?: string;
  trivial_by?: string;
  library_trivial_by?: string;
  unused: boolean;
  in_leaf_context: boolean;
  counted: boolean;
  note?: string;
};
export type LeafVerdict = "hollow" | "not_hollow" | "untestable";
export type Leaf = { line: number; column: number; target: string; verdict: LeafVerdict; hollow_by?: string; false_leaf: boolean; route?: "tactic" | "text"; root_modified: boolean; note?: string };
export type SketchCounts = { closed: number; closed_with_bullets: number; closed_leaf_used: number; open: number; untestable: number };
export type Analysis = {
  status: "errors" | "sorries" | "complete" | "noVerdict";
  leaves: Leaf[];
  steps: Step[];
  counts: SketchCounts;
  hollow: boolean;
  false_leaf: boolean;
  restates_root: boolean;
  statement_type_identical: boolean | null;
  truncated: boolean;
  suite: string;
  error?: string;
  elapsed_ms: number;
};

// ---- Text utilities (pure) ----

export type Pos = { line: number; column: number };
const cmp = (a: Pos, b: Pos) => a.line - b.line || a.column - b.column;
const inside = (p: Pos, span: [Pos, Pos]) => cmp(span[0], p) <= 0 && cmp(p, span[1]) < 0;
const excerpt = (s: string) => Array.from(s).slice(0, NOTE_CHARS).join("");
const bounded = (s: string, max: number) => (Array.from(s).length > max ? Array.from(s).slice(0, max).join("") : s);

/** The string index of `pos` (1-based line, 0-based column in codepoints); the end of the line or text when past it. */
export function offsetOf(text: string, pos: Pos): number {
  let offset = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 === pos.line) {
      let idx = 0;
      let col = 0;
      for (const ch of lines[i]) {
        if (col === pos.column) return offset + idx;
        idx += ch.length;
        col++;
      }
      return offset + lines[i].length;
    }
    offset += lines[i].length + 1;
  }
  return text.length;
}

/** The first index at bracket depth 0 where `sep` starts. */
export function splitTop(text: string, sep: string): number | undefined {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("([{⟨".includes(c)) depth++;
    else if (")]}⟩".includes(c)) depth--;
    else if (depth === 0 && text.startsWith(sep, i)) return i;
  }
  return undefined;
}

export type StepText = { kind: "have" | "obtain"; name: string; statement: string; byMode: boolean };

/** A tactic's text read as a step: `have <pat> : <type> := <rest>`; undefined for anything else, including a step without a stated type. */
export function parseStep(tactic: string): StepText | undefined {
  let kind: "have" | "obtain";
  let body: string;
  if (tactic.startsWith("have")) (kind = "have"), (body = tactic.slice(4));
  else if (tactic.startsWith("obtain")) (kind = "obtain"), (body = tactic.slice(6));
  else return undefined;
  if (![" ", "\n", ":", "⟨"].includes(body[0] ?? "")) return undefined;
  const i = splitTop(body, ":=");
  if (i === undefined) return undefined;
  const head = body.slice(0, i);
  const rest = body.slice(i + 2).trim();
  const j = splitTop(head, ":");
  if (j === undefined) return undefined;
  const pat = head.slice(0, j).trim();
  const statement = head.slice(j + 1).trim();
  const byMode = rest.startsWith("by") && !/^[\p{L}\p{N}_]/u.test(rest.slice(2));
  return { kind, name: pat || "this", statement, byMode };
}

const indentOf = (line: string) => Array.from(line).length - Array.from(line.trimStart()).length;

/** The spans of the `·` blocks: from the bullet to the last non-blank line indented deeper than it. */
export function bullets(text: string): [Pos, Pos][] {
  const lines = text.split("\n");
  const out: [Pos, Pos][] = [];
  lines.forEach((line, i) => {
    if (!line.trimStart().startsWith("·")) return;
    const ind = indentOf(line);
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || indentOf(lines[j]) > ind)) j++;
    while (j > i + 1 && lines[j - 1].trim() === "") j--;
    out.push([
      { line: i + 1, column: ind },
      { line: j, column: Array.from(lines[j - 1] ?? "").length },
    ]);
  });
  return out;
}

/** Whether the `sorry` at `pos` is a tactic (rather than a term such as `:= sorry`, `exact sorry`, `⟨sorry, _⟩`). */
export function sorryIsTactic(text: string, pos: Pos): boolean {
  const lines = text.split("\n");
  const li = pos.line - 1;
  const before = Array.from(lines[li] ?? "").slice(0, pos.column).join("").trimEnd();
  if (!before) {
    const prev = (lines.slice(0, li).reverse().find((l) => l.trim()) ?? "").trimEnd();
    return !prev.endsWith(":=");
  }
  return ["by", "·", "=>", ";", "<;>"].some((k) => before.endsWith(k));
}

export type Goal = { hyps: [string[], string][]; target?: string };

export function parseGoal(goal: string): Goal {
  const lines = goal.split("\n");
  if (lines[0]?.startsWith("case ")) lines.shift();
  const out: Goal = { hyps: [] };
  let cur: "none" | "target" | "hyp" = "none";
  for (const line of lines) {
    if (line.startsWith("⊢")) {
      out.target = line.slice(1).trim();
      cur = "target";
      continue;
    }
    if (cur === "target") {
      out.target += `\n${line}`;
      continue;
    }
    const sep = line.startsWith(" ") ? -1 : line.indexOf(" : ");
    if (sep !== -1) {
      out.hyps.push([line.slice(0, sep).split(" "), line.slice(sep + 3)]);
      cur = "hyp";
    } else if (!line.startsWith(" ") && line.endsWith(" :")) {
      out.hyps.push([line.slice(0, -2).split(" "), ""]);
      cur = "hyp";
    } else if (cur === "hyp" && out.hyps.length) out.hyps[out.hyps.length - 1][1] += `\n${line}`;
  }
  return out;
}

const names = (g: Goal) => g.hyps.flatMap(([n]) => n);

/** The frozen statement's binders and target: after `theorem <thm>` up to the final `:=`, split at the first colon outside brackets. */
export function parseStatement(statement: string, thm: string): [string, string] | undefined {
  if (!statement.startsWith("theorem")) return undefined;
  let rest = statement.slice(7).trimStart();
  if (!rest.startsWith(thm)) return undefined;
  rest = rest.slice(thm.length);
  if (rest.length && IDENT_CONT.test(rest[0])) return undefined;
  if (rest.endsWith(":=")) rest = rest.slice(0, -2);
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if ("([{⟨".includes(c)) depth++;
    else if (")]}⟩".includes(c)) depth--;
    else if (c === ":" && depth === 0 && !rest.startsWith(":=", i)) return [rest.slice(0, i).trim(), rest.slice(i + 1).trim()];
  }
  return undefined;
}

const IDENT_START = /[A-Za-z_À-ɏͰ-Ͽᴀ-ᶿ℀-⅏∀-⋿]/u;
const IDENT_CONT = /[\p{L}\p{N}_'!?¹²³✝⁰-⁹₀-ₜͰ-Ͽ]/u;

/** The identifier-like tokens of `text`. */
export function idents(text: string): Set<string> {
  const out = new Set<string>();
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    if (!IDENT_START.test(chars[i])) continue;
    let tok = chars[i];
    while (i + 1 < chars.length && IDENT_CONT.test(chars[i + 1])) tok += chars[++i];
    out.add(tok);
  }
  return out;
}

const stepNames = (pattern: string) => [...idents(pattern)].filter((n) => n !== "_").sort();
const capped = (tactic: string) => `set_option maxHeartbeats ${ANALYSIS_HEARTBEATS} in (${tactic})`;

/** The `Try this: …` suggestion of a tactic's messages (a leading `[kind]` tag dropped). */
export function parseTryThis(messages: RawMessage[] = []): string | undefined {
  const m = messages.map((x) => x.data.split("Try this:")).find((p) => p.length > 1);
  if (!m) return undefined;
  const data = m.slice(1).join("Try this:").trim();
  return data.startsWith("[") && data.includes("]") ? data.slice(data.indexOf("]") + 1).trimStart() : data;
}

const hasErrors = (r: RawCommand) => r.message !== undefined || (r.messages ?? []).some((m) => m.severity === "error");
/** The proof state a successful tactic reply produced. */
const advanced = (r: RawTactic) => (r.message !== undefined || (r.messages ?? []).some((m) => m.severity === "error") ? undefined : r.proofState);

// ---- Driving the REPL under a budget ----

class Abort extends Error {}

class Driver {
  private started = Date.now();
  constructor(
    private readonly s: ReplSession,
    private readonly budget: number,
    private readonly perRequest: number,
  ) {}
  elapsed = () => Date.now() - this.started;
  private timeout(): number {
    const left = this.budget - this.elapsed();
    if (left <= 0) throw new Abort(`wall-clock budget of ${Math.round(this.budget / 1000)} s exhausted`);
    return Math.min(left, this.perRequest);
  }
  async command(src: string, env: number, allTactics = false): Promise<RawCommand> {
    try {
      return await this.s.command(src, env, allTactics, this.timeout());
    } catch (e) {
      throw e instanceof Abort ? e : new Abort((e as Error).message);
    }
  }
  async tactic(t: string, ps: number): Promise<RawTactic> {
    try {
      return await this.s.tactic(t, ps, this.timeout());
    } catch (e) {
      throw e instanceof Abort ? e : new Abort((e as Error).message);
    }
  }
}

/**
 * The name an unused-variable warning reports: upstream reads Lean's older
 * wording ("unused variable"); Lean 4.36 says "Variable name … is not
 * explicitly referenced".
 */
export function unusedName(message: string): string | undefined {
  return /^unused variable `([^`]+)`/.exec(message)?.[1] ?? /^Variable name `([^`]+)` is not explicitly referenced/.exec(message)?.[1];
}

/** Run `suite` in order on `proofState`, each as `prefix` + capped tactic; it closes when the reply has no error and exactly `remaining` goals. */
async function runSuite(d: Driver, proofState: number, prefix: string, remaining: number, suite: string[]): Promise<{ tactic: string; suggestion?: string } | undefined> {
  for (const tactic of suite) {
    const r = await d.tactic(`${prefix}${capped(tactic)}`, proofState);
    if (advanced(r) !== undefined && (r.goals ?? []).length === remaining) return { tactic, suggestion: parseTryThis(r.messages) };
  }
  return undefined;
}

// ---- The frozen problem ----

type Root = { ppEnv: number; locals: Map<string, string>; targetPp: string; targetSrc: string; head: string; pristineType?: string };

const checkLine = (thm: string) => `set_option pp.all true in #check @${thm}`;
const checkedType = (r: RawCommand, thm: string) =>
  (r.messages ?? []).find((m) => m.severity === "info" && new RegExp(`^@?${thm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.\\{[^}]*\\})? : `).test(m.data.trimStart()))?.data.trim();
const renamed = (statement: string, thm: string, suffix: string) => statement.replace(`theorem ${thm}`, `theorem ${thm}_${suffix}`);

async function root(d: Driver, mathlibEnv: number, frozenBody: string, statement: string, thm: string): Promise<Root> {
  const frozen = await d.command(frozenBody, mathlibEnv);
  if (hasErrors(frozen) || frozen.env === undefined) throw new Abort("the frozen file does not elaborate on the REPL");
  const pristineType = checkedType(await d.command(checkLine(thm), frozen.env), thm);
  const pp = await d.command(PP_OPTIONS, frozen.env);
  const parts = parseStatement(statement, thm);
  if (!parts) throw new Abort("the frozen statement has no top-level colon");
  const head = statement.endsWith(":=") ? statement.slice(0, -2) : statement;
  const copy = await d.command(`${renamed(head, thm, "rootcopy")}:= by\n  sorry`, pp.env!);
  const goal = copy.sorries?.[0] ? parseGoal(copy.sorries[0].goal) : undefined;
  if (!goal) throw new Abort("the root copy of the frozen theorem has no sorry");
  const locals = new Map<string, string>();
  for (const [ns, ty] of goal.hyps) for (const n of ns) locals.set(n, ty);
  return { ppEnv: pp.env!, locals, targetPp: goal.target ?? "", targetSrc: parts[1], head: renamed(head, thm, "textroute"), pristineType };
}

// ---- The analysis ----

type Cand = { kind: StepKind; name?: string; statement?: string; byMode: boolean; span: [Pos, Pos]; proofState?: number; closed: boolean };
type Work = { stateOk: boolean[]; names: string[][]; leafContext: Set<string>; restatesRoot: boolean };
type Tactic = NonNullable<RawCommand["tactics"]>[number];
type Sorry = NonNullable<RawCommand["sorries"]>[number];

/** Analyse one candidate against its frozen file. Never fails: whatever stopped the analysis is in `error`, and the counts are over what was obtained. */
export async function analyzeSketch(session: ReplSession, frozen: string, candidate: string, opts: { wallMs?: number; perRequestMs?: number } = {}): Promise<Analysis> {
  const out: Analysis = {
    status: "sorries",
    leaves: [],
    steps: [],
    counts: { closed: 0, closed_with_bullets: 0, closed_leaf_used: 0, open: 0, untestable: 0 },
    hollow: false,
    false_leaf: false,
    restates_root: false,
    statement_type_identical: null,
    truncated: false,
    suite: ANALYSIS_SUITE_ID,
    elapsed_ms: 0,
  };
  const work: Work = { stateOk: [], names: [], leafContext: new Set(), restatesRoot: false };
  const d = new Driver(session, opts.wallMs ?? ANALYZE_WALL_MS, opts.perRequestMs ?? 60_000);
  try {
    await run(d, session.mathlibEnv, frozen, candidate, out, work);
  } catch (e) {
    out.error = (e as Error).message;
  }
  finalize(out, work);
  out.elapsed_ms = d.elapsed();
  return out;
}

async function run(d: Driver, mathlibEnv: number, frozen: string, candidate: string, out: Analysis, work: Work): Promise<void> {
  const statement = extractStatement(frozen);
  const thm = statement && theoremName(statement);
  if (!statement || !thm) throw new Abort("the frozen file has no theorem statement");
  const body = splitHeader(candidate).body;
  const frozenBody = splitHeader(frozen).body;
  // 1. The real check.
  const real = await d.command(body, mathlibEnv);
  out.status = real.message !== undefined || hasErrors(real) ? "errors" : (real.sorries ?? []).length ? "sorries" : "complete";
  if (out.status !== "sorries") return;
  out.counts.open = real.sorries!.length;
  const env1 = real.env!;
  const r = await root(d, mathlibEnv, frozenBody, statement, thm);
  // Statement type identity, `verify`'s check applied to a partial proof.
  const candidateType = checkedType(await d.command(checkLine(thm), env1), thm);
  out.statement_type_identical = candidateType !== undefined && r.pristineType !== undefined ? candidateType === r.pristineType : null;
  // 2. The renamed copy, in the env after the real check, with every tactic.
  const start = body.indexOf(statement);
  if (start === -1) throw new Abort("the statement is not in the prepared candidate");
  const pre = body.slice(0, start);
  const padding = Array.from(pre).map((c) => (c === "\n" ? "\n" : " ")).join("");
  const copy = `${padding}${renamed(body.slice(start), thm, "sketch")}`;
  const ppEnv = (await d.command(PP_OPTIONS, env1)).env!;
  const sketch = await d.command(copy, ppEnv, true);
  // A sorry in a declaration written before the theorem is open work but not a leaf of this theorem.
  const statementLine = (pre.match(/\n/g) ?? []).length + 1;
  const inTheorem = real.sorries!.filter((s) => s.pos.line >= statementLine).length;
  const sorries = sketch.sorries ?? [];
  if (hasErrors(sketch) || sorries.length !== inTheorem) {
    const errors = (sketch.messages ?? []).filter((m) => m.severity === "error").map((m) => excerpt(m.data)).slice(0, 2);
    throw new Abort(`the renamed copy differs from the candidate: ${sorries.length} sorries against ${inTheorem}; errors: ${errors.join("; ")}${sketch.message ? `; ${sketch.message}` : ""}`);
  }
  for (const s of sorries) for (const n of names(parseGoal(s.goal))) work.leafContext.add(n);
  // 3. Closed steps.
  const sorryPositions = sorries.map((s) => s.pos);
  const tactics = sketch.tactics ?? [];
  const cands: Cand[] = tactics.flatMap((t) => {
    const step = parseStep(t.tactic);
    if (!step) return [];
    const span: [Pos, Pos] = [t.pos, t.endPos];
    return [{ kind: step.kind, name: step.name, statement: step.statement, byMode: step.byMode, span, proofState: t.proofState, closed: !sorryPositions.some((p) => inside(p, span)) }];
  });
  for (const span of bullets(copy)) cands.push({ kind: "bullet", byMode: true, span, closed: !sorryPositions.some((p) => inside(p, span)) });
  const same = (a: [Pos, Pos], b: [Pos, Pos]) => cmp(a[0], b[0]) === 0 && cmp(a[1], b[1]) === 0;
  const maximal = cands.map((c) => c.closed && !cands.some((o) => o.closed && !same(o.span, c.span) && inside(c.span[0], o.span) && cmp(c.span[1], o.span[1]) <= 0));
  const haveSteps: [number, [Pos, Pos]][] = [];
  for (const [i, cand] of cands.entries()) {
    if (!maximal[i]) continue;
    const [state, note] = await statementState(d, cand, tactics);
    let trivialBy: string | undefined;
    let libraryTrivialBy: string | undefined;
    if (state) {
      trivialBy = (await runSuite(d, state[0], state[1], state[2], ANALYSIS_SUITE))?.tactic;
      if (!trivialBy) {
        // The copy is elaborated after the candidate, so `exact?` may cite the theorem itself: circular, not a library fact.
        const found = await runSuite(d, state[0], state[1], state[2], [LIBRARY_SEARCH]);
        const text = found && bounded(found.suggestion ?? found.tactic, MAX_ANALYSIS_TEXT_CHARS);
        libraryTrivialBy = text && !text.includes(thm) ? text : undefined;
      }
    }
    const index = out.steps.length;
    if (cand.kind !== "bullet") haveSteps.push([index, cand.span]);
    work.stateOk.push(!!state);
    work.names.push(cand.name ? stepNames(cand.name) : []);
    out.steps.push({
      kind: cand.kind,
      line: cand.span[0].line,
      column: cand.span[0].column,
      name: cand.name,
      statement: cand.statement && bounded(cand.statement, MAX_ANALYSIS_TEXT_CHARS),
      trivial_by: trivialBy,
      library_trivial_by: libraryTrivialBy,
      unused: false,
      in_leaf_context: false,
      counted: false,
      note,
    });
  }
  // 3b. Used: the linter on a sorry-free copy.
  if (haveSteps.length) {
    const note = await lint(d, env1, copy, sorries, haveSteps, out, work);
    if (note && !out.error) out.error = note;
  }
  // 4. Leaves.
  for (const s of sorries) out.leaves.push(await leaf(d, r, s, work));
}

/** A step's statement state — where the suite runs — with the goal-selecting prefix and the goals that remain once the statement is closed. */
async function statementState(d: Driver, cand: Cand, tactics: Tactic[]): Promise<[[number, string, number] | undefined, string | undefined]> {
  if (cand.kind === "bullet" || cand.byMode) {
    const inner = tactics
      .filter((t) => cmp(cand.span[0], t.pos) < 0 && cmp(t.endPos, cand.span[1]) <= 0)
      .sort((a, b) => cmp(a.pos, b.pos))[0];
    if (!inner || inner.proofState === undefined) return [undefined, "no inner tactic"];
    const remaining = cand.kind === "bullet" ? Math.max(0, (inner.goals.match(/\n⊢/g) ?? []).length - 1) : 0;
    return [[inner.proofState, "", remaining], undefined];
  }
  if (cand.proofState === undefined || !cand.statement) return [undefined, "no proof state"];
  const r = await d.tactic(`have this : ${cand.statement} := ?hole`, cand.proofState);
  const hole = advanced(r);
  if (hole !== undefined && (r.goals ?? []).length === 2) return [[hole, "case hole => ", 1], undefined];
  const why = r.message ?? (r.messages ?? []).filter((m) => m.severity === "error").map((m) => m.data).join("; ");
  return [undefined, `could not restate: ${excerpt(why)}`];
}

/** Mark unused steps: sorries become the axiom `leaf_hole`, the copy is linted, fully unused steps become `skip` for another round. */
async function lint(d: Driver, env1: number, copy: string, sorries: Sorry[], haveSteps: [number, [Pos, Pos]][], out: Analysis, work: Work): Promise<string | undefined> {
  const lintEnv = (await d.command(LINT_ENV, env1)).env!;
  let edited = copy;
  for (const s of [...sorries].sort((a, b) => cmp(b.pos, a.pos))) {
    const a = offsetOf(edited, s.pos);
    const b = offsetOf(edited, s.endPos ?? { line: s.pos.line, column: s.pos.column + 5 });
    if (a < b && b <= edited.length) edited = edited.slice(0, a) + (sorryIsTactic(copy, s.pos) ? "exact leaf_hole" : "leaf_hole") + edited.slice(b);
  }
  for (let round = 0; round < LINT_ROUNDS; round++) {
    const rr = await d.command(edited, lintEnv);
    if (hasErrors(rr) || (rr.sorries ?? []).length) {
      const errors = (rr.messages ?? []).filter((m) => m.severity === "error").map((m) => excerpt(m.data)).slice(0, 2);
      return `the lint copy is not clean (round ${round}): ${(rr.sorries ?? []).length} sorries; ${errors.join("; ")}`;
    }
    const unused = new Set(
      (rr.messages ?? []).flatMap((m) => {
        const name = m.severity === "warning" ? unusedName(m.data) : undefined;
        return name ? [`${m.pos.line}:${name}`] : [];
      }),
    );
    const newly: [Pos, Pos][] = [];
    for (const [index, span] of haveSteps) {
      const step = out.steps[index];
      if (!step || step.unused || step.name === "this") continue;
      const ns = work.names[index] ?? [];
      if (ns.length && ns.every((n) => unused.has(`${span[0].line}:${n}`))) {
        step.unused = true;
        newly.push(span);
      }
    }
    if (!newly.length) break;
    for (const span of newly.sort((a, b) => cmp(b[0], a[0]))) {
      const a = offsetOf(edited, span[0]);
      const b = offsetOf(edited, span[1]);
      if (a < b && b <= edited.length) edited = `${edited.slice(0, a)}skip${"\n".repeat((edited.slice(a, b).match(/\n/g) ?? []).length)}${edited.slice(b)}`;
    }
  }
  return undefined;
}

/** Run the suite on an opened `H : <leaf> ⊢ <frozen target>`, then keep it honest with a control no consistent hypothesis proves. */
async function hollowness(d: Driver, opened: number, prefix: string, remaining: number): Promise<{ verdict: LeafVerdict; hollow_by?: string; vacuous?: string }> {
  const closed = await runSuite(d, opened, prefix, remaining, ANALYSIS_SUITE);
  if (!closed) return { verdict: "not_hollow" };
  const anything = await runSuite(d, opened, `${prefix}${VACUITY_CONTROL}`, remaining, ANALYSIS_SUITE);
  if (anything)
    return {
      verdict: "untestable",
      vacuous: `the stripped statement proves anything (\`${anything.tactic}\` closes \`0 = 1\` from it), so deriving the theorem from it (\`${closed.tactic}\`) is no evidence of hollowness`,
    };
  return { verdict: "hollow", hollow_by: closed.tactic };
}

/** The hollow test of one leaf, with the text route as the fallback. */
async function leaf(d: Driver, root: Root, s: Sorry, work: Work): Promise<Leaf> {
  const goal = parseGoal(s.goal);
  const target = goal.target ?? "";
  if (target.trim() === root.targetPp.trim() || target.trim() === root.targetSrc.trim()) work.restatesRoot = true;
  const out: Leaf = { line: s.pos.line, column: s.pos.column, target: bounded(target, MAX_ANALYSIS_TEXT_CHARS), verdict: "untestable", false_leaf: ["False", "⊥"].includes(target.trim()), root_modified: false };
  if (s.proofState === undefined) return { ...out, note: "no proof state" };
  const hyps = goal.hyps.map(([n, t]) => [[...n], t] as [string[], string]);
  let ps = s.proofState;
  // Inaccessible names get fresh ones so they can be cleared or reverted.
  const inaccessible = names(goal).filter((n) => n.includes("✝"));
  if (inaccessible.length) {
    const fresh = inaccessible.map((_, k) => `inacc_${k}`);
    const r = await d.tactic(`rename_i ${fresh.join(" ")}`, ps);
    const next = advanced(r);
    if (next !== undefined) {
      ps = next;
      for (const [ns] of hyps) ns.forEach((n, i) => inaccessible.includes(n) && (ns[i] = fresh[inaccessible.indexOf(n)]));
    }
  }
  const flat = new Set(hyps.flatMap(([n]) => n));
  out.root_modified = [...root.locals.keys()].some((n) => !flat.has(n)) || hyps.some(([ns, ty]) => ns.some((n) => root.locals.has(n) && root.locals.get(n)!.trim() !== ty.trim()));
  const nonroot = hyps.flatMap(([n]) => n).filter((n) => !root.locals.has(n));
  // strip_dep: clear every sketch-introduced local newest first; what `clear` refuses is reverted into the statement.
  const cleared = new Set<string>();
  for (const n of [...nonroot].reverse()) {
    const next = advanced(await d.tactic(`clear ${n}`, ps));
    if (next !== undefined) {
      ps = next;
      cleared.add(n);
    }
  }
  const toRevert = nonroot.filter((n) => !cleared.has(n));
  if (toRevert.length) {
    const r = await d.tactic(`revert ${toRevert.join(" ")}`, ps);
    const next = advanced(r);
    if (next === undefined) return { ...out, note: `revert failed: ${excerpt(r.message ?? "")}` };
    ps = next;
  }
  const r = await d.tactic(`refine Iff.mp (a := (${root.targetSrc})) ⟨?d1, fun H => ?hollow⟩ ?d2`, ps);
  const opened = advanced(r);
  if (opened !== undefined && (r.goals ?? []).length === 3) {
    const h = await hollowness(d, opened, "case hollow => ", 2);
    return { ...out, verdict: h.verdict, hollow_by: h.hollow_by, note: h.vacuous, route: "tactic" };
  }
  const why = `root target does not elaborate in the leaf's context: ${excerpt(r.message ?? "")}`;
  // A goal that is not a proposition has no hollow test at all.
  if (advanced(await d.tactic("by_contra leaf_probe", ps)) === undefined) return { ...out, note: `data-typed leaf (the target is not a proposition); ${why}` };
  return textRoute(d, root, s, out, why);
}

/** The text route: revert the leaf's locals, re-elaborate the printed closed statement as `have H : … := sorry` in a renamed copy of the frozen theorem, and test it there. */
async function textRoute(d: Driver, root: Root, s: Sorry, out: Leaf, why: string): Promise<Leaf> {
  const goal = parseGoal(s.goal);
  const ns = names(goal).filter((n) => !n.includes("✝"));
  let stated = s.goal;
  if (ns.length) {
    const r = await d.tactic(`revert ${ns.join(" ")}`, s.proofState!);
    if (advanced(r) === undefined || !r.goals?.[0]) return { ...out, note: `${why} | text route: revert failed` };
    stated = r.goals[0];
  }
  const closed = parseGoal(stated);
  if (closed.hyps.length) return { ...out, note: `${why} | text route: inaccessible locals remain` };
  const statement = (closed.target ?? "").replace(/\n/g, "\n    ");
  const rr = await d.command(`${root.head}:= by\n  have H : ${statement} := sorry\n  sorry`, root.ppEnv);
  if (hasErrors(rr) || (rr.sorries ?? []).length < 2) {
    const errors = (rr.messages ?? []).filter((m) => m.severity === "error").map((m) => excerpt(m.data)).slice(0, 2);
    return { ...out, note: `${why} | text route: statement does not re-elaborate: ${errors.join("; ")}` };
  }
  const withH = rr.sorries!.find((x) => x.goal.includes("\nH :") || x.goal.startsWith("H :"));
  if (!withH || withH.proofState === undefined) return { ...out, note: `${why} | text route: no state with H` };
  const h = await hollowness(d, withH.proofState, "", 0);
  return { ...out, verdict: h.verdict, hollow_by: h.hollow_by, route: "text", note: h.vacuous ? `${why} | ${h.vacuous}` : why };
}

/** Counts, flags, ordering and bounds — over whatever was obtained. */
function finalize(out: Analysis, work: Work): void {
  const counts: SketchCounts = { closed: 0, closed_with_bullets: 0, closed_leaf_used: 0, open: out.counts.open, untestable: 0 };
  out.steps.forEach((step, i) => {
    const stateOk = work.stateOk[i] ?? false;
    const ns = work.names[i] ?? [];
    step.in_leaf_context = step.kind === "bullet" || step.name === "this" || ns.some((n) => work.leafContext.has(n));
    const nonTrivial = stateOk && !step.trivial_by && !step.library_trivial_by;
    step.counted = nonTrivial && !step.unused;
    if (step.counted) {
      counts.closed_with_bullets++;
      if (step.kind !== "bullet") counts.closed++;
    }
    if (step.kind !== "bullet" && nonTrivial && (!step.unused || step.in_leaf_context)) counts.closed_leaf_used++;
  });
  counts.untestable = out.leaves.filter((l) => l.verdict === "untestable").length;
  out.counts = counts;
  out.hollow = out.leaves.some((l) => l.verdict === "hollow");
  out.false_leaf = out.leaves.some((l) => l.false_leaf);
  out.restates_root = work.restatesRoot;
  out.steps.sort((a, b) => a.line - b.line || a.column - b.column);
  out.leaves.sort((a, b) => a.line - b.line || a.column - b.column);
  if (out.steps.length > MAX_ANALYSIS_ITEMS || out.leaves.length > MAX_ANALYSIS_ITEMS) {
    out.truncated = true;
    out.steps.length = Math.min(out.steps.length, MAX_ANALYSIS_ITEMS);
    out.leaves.length = Math.min(out.leaves.length, MAX_ANALYSIS_ITEMS);
  }
}

/** Upstream's score of a `sorries` node (`interfaces/discovery/src/scoring.rs`): 0.5 + 0.4 · C / (C + L); 0.5 with a hollow leaf, when nothing counts, or without an analysis. */
export function sketchScore(a: Analysis | undefined): number {
  if (!a || a.status !== "sorries") return 0.5;
  const { closed, open } = a.counts;
  if (a.hollow || closed + open === 0) return 0.5;
  return 0.5 + (0.4 * closed) / (closed + open);
}
