// The single-agent prove loop (build step 1): the model proposes a complete
// Lean file, the quick check reports errors or open goals back to it, and a
// candidate counts as solved only when `verifyText` accepts it. What the
// model says about its own proof decides nothing.

import { checkFromRun, describeCheck, type LeanCheckRun } from "./lean/check";
import { extractStatement, frozenObjection, protocolObjection } from "./lean/rules";
import { describeRejection, excerpt, pristineType, verifyText, type LeanRun } from "./lean/verify";
import type { ChatMessage, ModelProvider } from "./model/provider";
import { prepare, type Lemma, type PrepareEvent } from "./prepare";
import { unknownNames } from "./lean/mathlib-index";
import { sweep } from "./lean/analysis";

export type AttemptOutcome = "refused" | "no verdict" | "errors" | "sorries" | "rejected" | "verified";

export type ProveEvent =
  | { type: "status"; message: string }
  | { type: "attempt"; n: number; candidate: string; outcome: AttemptOutcome; detail: string; ms: number; tokens: number }
  | { type: "solved"; n: number; proof: string; axioms: string[] }
  | { type: "failed"; message: string }
  | PrepareEvent;

export type ProveOptions = {
  frozen: string;
  provider: ModelProvider;
  model: string;
  run: LeanRun;
  /** The quick check (the resident REPL); a fresh `run` when absent. */
  check?: LeanCheckRun;
  maxAttempts: number;
  /** Independent chains of attempts run at once, sharing the attempt budget; the first verified proof stops the others. */
  parallel?: number;
  /** The steps before the first attempt (core/prepare.ts); none when absent. */
  prepare?: { checkStatement: boolean; idea: boolean };
  /** Lemmas this project has already proved, offered to every attempt. */
  lemmas?: Lemma[];
  /** Real Mathlib names close to ones Lean did not know, as a note for the next attempt. */
  lookup?: (unknown: string[]) => Promise<string>;
  /** A model trained for Lean (DeepSeek-Prover, Kimina, Goedel) that writes the attempts; `model` then only plans. */
  prover?: { provider: ModelProvider; model: string };
  /** Feedback rounds one chain gets before it starts over from a clean conversation (0: never). Many short independent tries beat one long one. */
  revisions?: number;
  /** Verified proofs of similar statements, shown to every attempt as worked examples. */
  examples?: string;
  /** Try Lean's automation on the statement before any model call, and on every `sorry` an attempt leaves (default on). */
  automation?: boolean;
  signal?: AbortSignal;
  onEvent: (e: ProveEvent) => void;
};

const SYSTEM = `You are a Lean 4 and Mathlib expert. You are given a frozen Lean file whose theorem is proved by \`sorry\`.
Reply with one complete Lean file in a single \`\`\`lean code block that proves the theorem.
Rules, enforced by a checker:
- Keep every line before the theorem exactly as given, and keep the theorem statement through its \`:=\` byte for byte.
- You may add helper lemmas between the preamble and the theorem.
- A step you expect to be routine (arithmetic, a simp lemma, a linear inequality) may be left as \`sorry\`: Mack tries Lean's automation (omega, norm_num, simp, linarith, nlinarith, positivity, aesop, grind, exact?) on every \`sorry\` and puts in what closes it. A \`sorry\` it cannot close comes back to you with its goal.
- Never use \`axiom\`, \`native_decide\`, \`set_option pp.*\`/\`debug.*\`, \`#eval\`, macros, notation or metaprogramming.
If the checker reports errors, fix them and reply with the whole corrected file.`;

/** The same task in the plain form prover models (DeepSeek-Prover, Kimina, Goedel) are trained on. */
const PROVER_TASK = (frozen: string, notes: string) =>
  `Complete the following Lean 4 code:\n\n\`\`\`lean4\n${frozen}\`\`\`\n\nKeep everything before \`:=\` exactly as given. Do not use \`axiom\` or \`native_decide\`. Before producing the Lean 4 code to formally prove the given theorem, provide a detailed proof plan outlining the main proof steps and strategies.${notes ? `\n\n${notes}` : ""}`;

/** The last ```lean block of a reply, or the whole reply when it has none. */
export function extractLean(reply: string): string {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const blocks = [...cleaned.matchAll(/```(?:lean4?|)\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return (blocks.length > 0 ? blocks[blocks.length - 1] : cleaned).trim() + "\n";
}

export async function prove(o: ProveOptions): Promise<void> {
  const objection = frozenObjection(o.frozen);
  if (objection) return o.onEvent({ type: "failed", message: `The problem file is not usable: ${objection}` });
  const statement = extractStatement(o.frozen);
  if (!statement) return o.onEvent({ type: "failed", message: "The problem file has no theorem statement." });

  o.onEvent({ type: "status", message: "Elaborating the frozen statement with Lean (first run loads Mathlib)…" });
  const pristine = await pristineType(o.frozen, o.run);
  if (!pristine.ok) return o.onEvent({ type: "failed", message: `Lean could not check the problem file:\n${pristine.reason}` });

  const quick: LeanCheckRun = o.check ?? (async (src) => checkFromRun(await o.run(src)));
  const prep = await prepare({ frozen: o.frozen, provider: o.provider, model: o.model, check: quick, checkStatement: !!o.prepare?.checkStatement, idea: !!o.prepare?.idea, lemmas: o.lemmas, signal: o.signal, onEvent: o.onEvent });
  if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
  if (prep.stop) return o.onEvent({ type: "failed", message: prep.stop });
  const automation = o.automation !== false;

  // Lean's automation first: a statement it closes needs no model call at all.
  if (automation) {
    o.onEvent({ type: "status", message: "Trying Lean's automation on the statement before asking a model…" });
    const t0 = Date.now();
    const swept = await sweep(o.frozen, quick, { wallMs: 60_000, maxSorries: 1 }).catch(() => null);
    if (swept?.completed && !o.signal?.aborted) {
      const verdict = await verifyText(o.frozen, pristine.type, swept.completed, o.run);
      if (verdict.ok) {
        o.onEvent({ type: "attempt", n: 0, candidate: swept.completed, outcome: "verified", detail: "closed by Lean's automation, no model call", ms: Date.now() - t0, tokens: 0 });
        return o.onEvent({ type: "solved", n: 0, proof: swept.completed, axioms: verdict.axioms });
      }
    }
  }
  const notes = [prep.notes, o.examples].filter(Boolean).join("\n\n");
  const writer = o.prover ?? { provider: o.provider, model: o.model };

  // The attempt budget is shared by every chain; the first verified proof stops the others.
  const chains = Math.max(1, Math.min(Math.floor(o.parallel ?? 1), 32, o.maxAttempts));
  const done = new AbortController();
  const signal = o.signal ? AbortSignal.any([o.signal, done.signal]) : done.signal;
  let started = 0;
  let solved = false;
  let modelError = "";
  const emit = (e: ProveEvent) => {
    if (!solved) o.onEvent(e);
  };
  const label = (n: number) => `Attempt ${n} of ${o.maxAttempts}${chains > 1 ? ` (${chains} at once)` : ""}`;

  const chain = async () => {
    const opening = (): ChatMessage[] =>
      o.prover
        ? [{ role: "user", content: PROVER_TASK(o.frozen, notes) }]
        : [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Frozen file:\n\`\`\`lean\n${o.frozen}\`\`\`${notes ? `\n\n${notes}` : ""}` },
          ];
    let messages = opening();
    let rounds = 0;
    while (!signal.aborted && started < o.maxAttempts) {
      // A chain that has revised long enough starts over: a fresh sample explores where revisions only patch.
      if (o.revisions && rounds >= o.revisions) {
        messages = opening();
        rounds = 0;
      }
      const n = ++started;
      emit({ type: "status", message: `${label(n)}: the model is writing a proof…` });
      const t0 = Date.now();
      let reply: string;
      let tokens = 0;
      try {
        const r = await writer.provider.chat({ model: writer.model, messages, maxTokens: o.prover ? 16384 : 8192, temperature: o.prover ? 0.9 : 0.6, signal });
        reply = r.content;
        tokens = r.usage?.completionTokens ?? 0;
      } catch (e) {
        if (!signal.aborted) modelError = (e as Error).message;
        return;
      }
      if (solved) return;
      messages.push({ role: "assistant", content: reply });
      let candidate = extractLean(reply);
      const attempt = (outcome: AttemptOutcome, detail: string) => emit({ type: "attempt", n, candidate, outcome, detail, ms: Date.now() - t0, tokens });

      const feedback = async (): Promise<string | null> => {
        const textual = protocolObjection(statement, candidate);
        if (textual) {
          attempt("refused", textual);
          return `The checker refused the file before running Lean: ${textual}`;
        }
        emit({ type: "status", message: `${label(n)}: Lean is checking the proof…` });
        let check = await quick(candidate);
        let swept = "";
        if (automation && check.status === "sorries") {
          emit({ type: "status", message: `${label(n)}: trying Lean's automation on each sorry…` });
          const sw = await sweep(candidate, quick).catch(() => null);
          if (sw && sw.closed > 0) {
            candidate = sw.current;
            check = await quick(candidate);
            swept = sw.open ? `Lean's automation closed ${sw.closed} of the ${sw.closed + sw.open} sorries; the file below has them filled in. ` : "";
          }
        }
        if (check.status === "noVerdict") {
          attempt("no verdict", check.output);
          return `Lean gave no verdict (${excerpt(check.output)}). Try a simpler or faster proof.`;
        }
        if (check.status === "errors" || check.status === "sorries") {
          attempt(check.status, check.output);
          const hint = o.lookup ? await o.lookup(unknownNames(check.errors.map((e) => e.message).join("\n"))).catch(() => "") : "";
          return `${swept}The checker's verdict:\n${describeCheck(check)}${hint ? `\n\n${hint}` : ""}${swept ? `\n\nThe file as it stands now:\n\`\`\`lean\n${candidate}\`\`\`` : ""}`;
        }
        emit({ type: "status", message: `${label(n)}: Lean accepts it; running the strict verifier…` });
        const verdict = await verifyText(o.frozen, pristine.type, candidate, o.run);
        if (verdict.ok) {
          if (solved) return null;
          attempt("verified", "");
          o.onEvent({ type: "solved", n, proof: candidate, axioms: verdict.axioms });
          solved = true;
          done.abort();
          return null;
        }
        const why = describeRejection(verdict.rejection);
        attempt("rejected", why);
        return `The verifier rejected the proof: ${why}`;
      };

      const next = await feedback();
      if (next === null) return;
      rounds++;
      messages.push({ role: "user", content: `${next}\n\nReply with the whole corrected file.` });
      // A prover model's replies are long reasoning: it revises its last attempt only, so the conversation fits its context.
      if (o.prover) messages = [...opening(), ...messages.slice(-2)];
    }
  };

  await Promise.all(Array.from({ length: chains }, chain));
  if (solved) return;
  if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
  if (modelError && started <= chains) return o.onEvent({ type: "failed", message: `Model call failed: ${modelError}` });
  o.onEvent({ type: "failed", message: `No verified proof after ${Math.min(started, o.maxAttempts)} attempts.${modelError ? ` The last model call failed: ${modelError}` : ""}` });
}
