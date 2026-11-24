// Decomposition: the method of the strongest recent provers (DeepSeek-Prover-V2,
// Seed-Prover). A statement the attempts do not prove directly is split by the
// planning model into a chain of `have` steps left as `sorry`; Lean's
// automation closes what it can; every step left becomes a lemma of its own,
// stated from the goal Lean reports there, and all of them are proved at once,
// each by the same attempts (and split again when they fail, to a set depth).
// The proved lemmas are put before the theorem, each `sorry` is replaced by a
// use of its lemma, and the whole file goes to the strict verifier: nothing a
// step claims counts until Lean accepts the assembled proof.

import { sorryOffsets, sweep } from "./lean/analysis";
import type { LeanCheckRun } from "./lean/check";
import { checkFromRun, describeCheck } from "./lean/check";
import { extractStatement, preambleCopy, protocolObjection, theoremName } from "./lean/rules";
import { describeRejection, pristineType, verifyText } from "./lean/verify";
import type { ChatMessage } from "./model/provider";
import { extractLean, prove, type ProveEvent, type ProveOptions } from "./prove";

export type DecomposeOptions = ProveOptions & {
  /** How many times a statement may be split again below the top one. */
  maxDepth?: number;
  /** Attempts on each statement (the theorem, then every lemma) before it is split. */
  lemmaAttempts?: number;
  /** Splits tried per statement, each told why the one before failed. */
  rounds?: number;
};

const MAX_STEPS = 8;

const SKELETON_SYSTEM = `You split a Lean 4 theorem into steps that a prover can do one at a time.
Reply with one complete Lean file in a single \`\`\`lean code block:
- Keep every line before the theorem, and the theorem statement through its \`:=\`, exactly as given.
- Prove the theorem with a short chain of 2 to 6 \`have\` steps, each stated precisely in Lean and proved by \`sorry\` (\`have h1 : … := by sorry\`), followed by a final step that closes the goal from them with no \`sorry\` (\`exact …\`, \`linarith [h1, h2]\`, \`nlinarith [...]\`, \`simp [h1] at *\`, \`omega\`, …).
- Each step must be true, follow from the hypotheses and the steps before it, and be clearly smaller than the theorem: a lemma a prover can finish in a few lines.
- Introduce variables with \`intro\` or \`obtain\` before the steps when the statement quantifies over them, so each step's goal is concrete.
- Never use \`axiom\` or \`native_decide\`.`;

/** One parsed goal: its hypotheses as binders, its target, and the names to pass. */
export type GoalLemma = { binders: string; target: string; args: string[] };

/**
 * A lemma statement from a goal as Lean prints it (`x y : ℝ`, `h : 0 < x`,
 * `⊢ target`), or null when the goal cannot be stated on its own: several
 * goals, a let-bound value, or a hypothesis Lean made inaccessible (`x✝`),
 * which no argument could name. Instance hypotheses (`inst✝ : Fintype α`)
 * become instance binders.
 */
export function goalToLemma(goal: string): GoalLemma | null {
  const lines = goal.replace(/\r\n/g, "\n").split("\n");
  if ((goal.match(/⊢/g) ?? []).length !== 1) return null;
  const entries: string[] = [];
  for (const line of lines) {
    if (!line.trim() || /^case\s/.test(line)) continue;
    if (/^\s/.test(line) && entries.length) entries[entries.length - 1] += ` ${line.trim()}`;
    else entries.push(line.trim());
  }
  const binders: string[] = [];
  const args: string[] = [];
  let target = "";
  for (const e of entries) {
    if (e.startsWith("⊢")) {
      target = e.slice(1).trim();
      continue;
    }
    const m = /^((?:[^\s:]+ )*[^\s:]+) : ([\s\S]+)$/.exec(e);
    if (!m) return null;
    const names = m[1].split(" ");
    const type = m[2].trim();
    if (/(^|\s):=(\s|$)/.test(type)) return null;
    if (names.every((n) => /^inst✝\d*$/.test(n))) {
      for (let i = 0; i < names.length; i++) binders.push(`[${type}]`);
      continue;
    }
    if (names.some((n) => n.includes("✝"))) return null;
    binders.push(`(${names.join(" ")} : ${type})`);
    args.push(...names);
  }
  if (!target) return null;
  return { binders: binders.join(" "), target, args };
}

const splice = (src: string, at: number, len: number, text: string) => src.slice(0, at) + text + src.slice(at + len);
const lineOf = (src: string, at: number) => src.slice(0, at).split("\n").length;

/**
 * The goal `trace_state` printed, read from Lean's whole output: newer Lean
 * prints it as bare text with no `file:line:col: info:` header, older Lean
 * under one. The probe has no errors, so the other lines are `sorry`
 * warnings, which are dropped. Null unless exactly one goal is left.
 */
export function goalFromOutput(output: string): string | null {
  const kept = output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !/^.*?:\d+:\d+: warning(\([^)\s]*\))?: declaration uses ['`]sorry['`]\s*$/.test(l))
    .map((l) => l.replace(/^.*?:\d+:\d+: info(\([^)\s]*\))?: /, ""))
    .join("\n")
    .trim();
  return (kept.match(/⊢/g) ?? []).length === 1 ? kept : null;
}

/** The goal Lean reports at the `sorry` at `at`, and whether that `sorry` stands where a term goes. */
export async function goalAt(source: string, at: number, check: LeanCheckRun): Promise<{ goal: string; term: boolean } | null> {
  const line = lineOf(source, at);
  for (const term of [false, true]) {
    const c = await check(splice(source, at, 5, term ? "(by trace_state; sorry)" : "(trace_state; sorry)"));
    if (c.status === "noVerdict" || c.errors.length) continue;
    const note = (c.notes ?? []).find((n) => n.line === line && n.message.includes("⊢"));
    if (note) return { goal: note.message, term };
    const bare = goalFromOutput(c.output);
    if (bare) return { goal: bare, term };
  }
  return null;
}

/** The frozen file's code before its statement (its doc comment and other comments left out). */
function preambleOf(frozen: string): string {
  const copy = preambleCopy(frozen, frozen);
  return copy ? frozen.slice(0, copy.frozenEnd) : "";
}

/** The text a verified proof adds after its preamble: its helper lemmas and the theorem with its proof. */
function bodyOf(frozen: string, proof: string): string {
  const copy = preambleCopy(frozen, proof);
  return (copy ? proof.slice(copy.candidateEnd) : proof).trim();
}

type Ctx = {
  o: DecomposeOptions;
  quick: LeanCheckRun;
  attempts: number;
  emit: (e: ProveEvent) => void;
};

/** Prove `frozen` with the ordinary attempts, reporting under `path`; the verified proof, or null. */
async function attemptDirect(ctx: Ctx, frozen: string, path: string, top: boolean): Promise<string | null> {
  const o = ctx.o;
  let proof: string | null = null;
  const tag = path ? `[step ${path}] ` : "";
  await prove({
    ...o,
    frozen,
    maxAttempts: o.lemmaAttempts ?? 16,
    // The steps of a split are plain lemmas: the statement checks and the plan in words belong to the theorem.
    prepare: top ? o.prepare : undefined,
    lemmas: top ? o.lemmas : undefined,
    onEvent: (e) => {
      if (e.type === "solved") proof = e.proof;
      else if (e.type === "attempt") ctx.emit({ ...e, n: ++ctx.attempts, detail: `${tag}${e.detail}` });
      else if (e.type === "status") ctx.emit({ type: "status", message: `${tag}${e.message}` });
      else if (e.type !== "failed") ctx.emit(e);
    },
  });
  return proof;
}

/** A split of `frozen` from the planning model: a file whose proof is `have` steps left as `sorry`, which Lean accepts as written. */
async function writeSkeleton(ctx: Ctx, frozen: string, statement: string, why: string, path: string): Promise<string | null> {
  const o = ctx.o;
  const messages: ChatMessage[] = [
    { role: "system", content: SKELETON_SYSTEM },
    { role: "user", content: `Frozen file:\n\`\`\`lean\n${frozen}\`\`\`${o.examples ? `\n\n${o.examples}` : ""}${why ? `\n\n${why}` : ""}` },
  ];
  for (let tries = 0; tries < 3 && !o.signal?.aborted; tries++) {
    ctx.emit({ type: "status", message: `${path ? `[step ${path}] ` : ""}The planning model is splitting the statement into steps…` });
    let reply: string;
    try {
      reply = (await o.provider.chat({ model: o.model, messages, maxTokens: 8192, temperature: 0.5, signal: o.signal })).content;
    } catch {
      return null;
    }
    const skeleton = extractLean(reply);
    messages.push({ role: "assistant", content: reply });
    const objection = protocolObjection(statement, skeleton);
    if (objection) {
      messages.push({ role: "user", content: `The checker refused the file: ${objection}. Reply with the whole corrected file.` });
      continue;
    }
    const c = await ctx.quick(skeleton);
    if (c.status === "sorries" || c.status === "complete") return skeleton;
    messages.push({ role: "user", content: `Lean does not accept the steps as written (a step left as sorry is fine; an error is not):\n${describeCheck(c)}\n\nReply with the whole corrected file.` });
  }
  return null;
}

/** Prove `frozen`: directly first, then by splitting it, recursively. The verified proof, or null. */
async function solve(ctx: Ctx, frozen: string, depth: number, path: string): Promise<string | null> {
  const o = ctx.o;
  const direct = await attemptDirect(ctx, frozen, path, depth === 0);
  if (direct || o.signal?.aborted || depth >= (o.maxDepth ?? 2)) return direct;
  const statement = extractStatement(frozen);
  const name = statement && theoremName(statement);
  if (!statement || !name) return null;
  const pristine = await pristineType(frozen, o.run);
  if (!pristine.ok) return null;
  const preamble = preambleOf(frozen);
  let why = "";
  for (let round = 0; round < (o.rounds ?? 2) && !o.signal?.aborted; round++) {
    const skeleton = await writeSkeleton(ctx, frozen, statement, why, path);
    if (!skeleton) return null;
    // Lean's automation first: the steps it closes need no lemma.
    const swept = o.automation === false ? { current: skeleton } : await sweep(skeleton, ctx.quick).catch(() => ({ current: skeleton }));
    let current = swept.current;
    const start = current.indexOf(statement);
    const offsets = sorryOffsets(current).filter((at) => at > start);
    if (offsets.length > MAX_STEPS) {
      why = `That split left ${offsets.length} steps open; use at most 6.`;
      continue;
    }
    // Each step left open becomes a lemma stated from Lean's own goal there.
    const steps: { at: number; term: boolean; lemma: string; args: string[]; frozen: string }[] = [];
    let unusable = "";
    for (const [k, at] of offsets.entries()) {
      const g = await goalAt(current, at, ctx.quick);
      const parsed = g && goalToLemma(g.goal);
      if (!g || !parsed) {
        unusable = `step ${k + 1}`;
        break;
      }
      const lemma = `${name}_step${path ? `${path.replace(/\./g, "_")}_` : ""}${k + 1}`;
      const lemmaFrozen = `${preamble}\n\ntheorem ${lemma} ${parsed.binders} :\n    ${parsed.target} := by\n  sorry\n`;
      const c = await ctx.quick(lemmaFrozen);
      if (c.status !== "sorries") {
        unusable = `step ${k + 1}`;
        break;
      }
      steps.push({ at, term: g.term, lemma, args: parsed.args, frozen: lemmaFrozen });
    }
    if (unusable) {
      why = `Lean could not state ${unusable} of the last split as a lemma of its own (its goal uses a hidden or let-bound name, or does not print back as Lean). Name every variable and hypothesis the steps use with \`intro\`/\`obtain\`, and state each step plainly.`;
      continue;
    }
    ctx.emit({ type: "status", message: `${path ? `[step ${path}] ` : ""}Split into ${steps.length} step${steps.length === 1 ? "" : "s"}; proving them at once…` });
    const proofs = await Promise.all(steps.map((s, k) => solve(ctx, s.frozen, depth + 1, path ? `${path}.${k + 1}` : `${k + 1}`)));
    const failed = proofs.flatMap((p, k) => (p ? [] : [k + 1]));
    if (failed.length) {
      why = `In the last split, step${failed.length > 1 ? "s" : ""} ${failed.join(", ")} could not be proved (it may be false, or too large a step). Split the theorem differently, with smaller or corrected steps.`;
      continue;
    }
    // Assemble: the lemmas after the preamble, each `sorry` replaced by its lemma, from the last back so offsets hold.
    for (let k = steps.length - 1; k >= 0; k--) {
      const s = steps[k];
      const use = `${s.lemma}${s.args.length ? ` ${s.args.join(" ")}` : ""}`;
      current = splice(current, s.at, 5, s.term ? `(${use})` : `exact ${use}`);
    }
    const copy = preambleCopy(frozen, current);
    const at = copy ? copy.candidateEnd : 0;
    const lemmas = steps.map((s, k) => bodyOf(s.frozen, proofs[k]!)).join("\n\n");
    const assembled = `${current.slice(0, at)}\n\n${lemmas}\n\n${current.slice(at).replace(/^\n+/, "")}`;
    const verdict = await verifyText(frozen, pristine.type, assembled, o.run);
    if (verdict.ok) return assembled;
    why = `The steps were all proved, but the assembled proof was rejected: ${describeRejection(verdict.rejection)}`;
  }
  return null;
}

/** Prove `o.frozen` by attempts, then by splitting it into lemmas proved at once; emits the same events as `prove`. */
export async function decompose(o: DecomposeOptions): Promise<void> {
  const quick: LeanCheckRun = o.check ?? (async (src) => checkFromRun(await o.run(src)));
  const ctx: Ctx = { o, quick, attempts: 0, emit: o.onEvent };
  const proof = await solve(ctx, o.frozen, 0, "");
  if (proof) {
    const pristine = await pristineType(o.frozen, o.run);
    const verdict = pristine.ok ? await verifyText(o.frozen, pristine.type, proof, o.run) : null;
    if (verdict?.ok) return o.onEvent({ type: "solved", n: ctx.attempts, proof, axioms: verdict.axioms });
  }
  if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
  o.onEvent({ type: "failed", message: `No verified proof: ${ctx.attempts} attempts, directly and on the steps of ${o.rounds ?? 2} splits per statement, to depth ${o.maxDepth ?? 2}.` });
}
