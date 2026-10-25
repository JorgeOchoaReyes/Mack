// The single-agent prove loop (build step 1): the model proposes a complete
// Lean file, the quick check reports errors or open goals back to it, and a
// candidate counts as solved only when `verifyText` accepts it. What the
// model says about its own proof decides nothing.

import { checkFromRun, describeCheck, type LeanCheckRun } from "./lean/check";
import { extractStatement, frozenObjection, protocolObjection } from "./lean/rules";
import { describeRejection, excerpt, pristineType, verifyText, type LeanRun } from "./lean/verify";
import type { ChatMessage, ModelProvider } from "./model/provider";

export type AttemptOutcome = "refused" | "no verdict" | "errors" | "sorries" | "rejected" | "verified";

export type ProveEvent =
  | { type: "status"; message: string }
  | { type: "attempt"; n: number; candidate: string; outcome: AttemptOutcome; detail: string; ms: number; tokens: number }
  | { type: "solved"; n: number; proof: string; axioms: string[] }
  | { type: "failed"; message: string };

export type ProveOptions = {
  frozen: string;
  provider: ModelProvider;
  model: string;
  run: LeanRun;
  /** The quick check (the resident REPL); a fresh `run` when absent. */
  check?: LeanCheckRun;
  maxAttempts: number;
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

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Frozen file:\n\`\`\`lean\n${o.frozen}\`\`\`` },
  ];
  for (let n = 1; n <= o.maxAttempts; n++) {
    if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
    o.onEvent({ type: "status", message: `Attempt ${n} of ${o.maxAttempts}: the model is writing a proof…` });
    const started = Date.now();
    let reply: string;
    let tokens = 0;
    try {
      const r = await o.provider.chat({ model: o.model, messages, maxTokens: 8192, temperature: 0.6, signal: o.signal });
      reply = r.content;
      tokens = r.usage?.completionTokens ?? 0;
    } catch (e) {
      if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
      return o.onEvent({ type: "failed", message: `Model call failed: ${(e as Error).message}` });
    }
    messages.push({ role: "assistant", content: reply });
    const candidate = extractLean(reply);
    const attempt = (outcome: AttemptOutcome, detail: string) =>
      o.onEvent({ type: "attempt", n, candidate, outcome, detail, ms: Date.now() - started, tokens });

    const feedback = async (): Promise<string | null> => {
      const textual = protocolObjection(statement, candidate);
      if (textual) {
        attempt("refused", textual);
        return `The checker refused the file before running Lean: ${textual}`;
      }
      o.onEvent({ type: "status", message: `Attempt ${n} of ${o.maxAttempts}: Lean is checking the proof…` });
      const check = o.check ? await o.check(candidate) : checkFromRun(await o.run(candidate));
      if (check.status === "noVerdict") {
        attempt("no verdict", check.output);
        return `Lean gave no verdict (${excerpt(check.output)}). Try a simpler or faster proof.`;
      }
      if (check.status === "errors" || check.status === "sorries") {
        attempt(check.status, check.output);
        return `The checker's verdict:\n${describeCheck(check)}`;
      }
      o.onEvent({ type: "status", message: `Attempt ${n} of ${o.maxAttempts}: Lean accepts it; running the strict verifier…` });
      const verdict = await verifyText(o.frozen, pristine.type, candidate, o.run);
      if (verdict.ok) {
        attempt("verified", "");
        o.onEvent({ type: "solved", n, proof: candidate, axioms: verdict.axioms });
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
  o.onEvent({ type: "failed", message: `No verified proof after ${o.maxAttempts} attempts.` });
}
