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
  signal?: AbortSignal;
  onEvent: (e: ProveEvent) => void;
};

const SYSTEM = `You are a Lean 4 and Mathlib expert. You are given a frozen Lean file whose theorem is proved by \`sorry\`.
Reply with one complete Lean file in a single \`\`\`lean code block that proves the theorem.
Rules, enforced by a checker:
- Keep every line before the theorem exactly as given, and keep the theorem statement through its \`:=\` byte for byte.
- You may add helper lemmas between the preamble and the theorem.
- Never use \`sorry\`, \`axiom\`, \`native_decide\`, \`set_option pp.*\`/\`debug.*\`, \`#eval\`, macros, notation or metaprogramming.
If the checker reports errors, fix them and reply with the whole corrected file.`;

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

  // The attempt budget is shared by every chain; the first verified proof stops the others.
  const chains = Math.max(1, Math.min(Math.floor(o.parallel ?? 1), 8, o.maxAttempts));
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
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Frozen file:\n\`\`\`lean\n${o.frozen}\`\`\`${prep.notes ? `\n\n${prep.notes}` : ""}` },
    ];
    while (!signal.aborted && started < o.maxAttempts) {
      const n = ++started;
      emit({ type: "status", message: `${label(n)}: the model is writing a proof…` });
      const t0 = Date.now();
      let reply: string;
      let tokens = 0;
      try {
        const r = await o.provider.chat({ model: o.model, messages, maxTokens: 8192, temperature: 0.6, signal });
        reply = r.content;
        tokens = r.usage?.completionTokens ?? 0;
      } catch (e) {
        if (!signal.aborted) modelError = (e as Error).message;
        return;
      }
      if (solved) return;
      messages.push({ role: "assistant", content: reply });
      const candidate = extractLean(reply);
      const attempt = (outcome: AttemptOutcome, detail: string) => emit({ type: "attempt", n, candidate, outcome, detail, ms: Date.now() - t0, tokens });

      const feedback = async (): Promise<string | null> => {
        const textual = protocolObjection(statement, candidate);
        if (textual) {
          attempt("refused", textual);
          return `The checker refused the file before running Lean: ${textual}`;
        }
        emit({ type: "status", message: `${label(n)}: Lean is checking the proof…` });
        const check = await quick(candidate);
        if (check.status === "noVerdict") {
          attempt("no verdict", check.output);
          return `Lean gave no verdict (${excerpt(check.output)}). Try a simpler or faster proof.`;
        }
        if (check.status === "errors" || check.status === "sorries") {
          attempt(check.status, check.output);
          const hint = o.lookup ? await o.lookup(unknownNames(check.errors.map((e) => e.message).join("\n"))).catch(() => "") : "";
          return `The checker's verdict:\n${describeCheck(check)}${hint ? `\n\n${hint}` : ""}`;
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
      messages.push({ role: "user", content: `${next}\n\nReply with the whole corrected file.` });
    }
  };

  await Promise.all(Array.from({ length: chains }, chain));
  if (solved) return;
  if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
  if (modelError && started <= chains) return o.onEvent({ type: "failed", message: `Model call failed: ${modelError}` });
  o.onEvent({ type: "failed", message: `No verified proof after ${Math.min(started, o.maxAttempts)} attempts.${modelError ? ` The last model call failed: ${modelError}` : ""}` });
}
