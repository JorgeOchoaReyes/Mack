// The single-agent prove loop (build step 1): the model proposes a complete
// Lean file, the quick check reports errors or open goals back to it, and a
// candidate counts as solved only when `verifyText` accepts it. What the
// model says about its own proof decides nothing.

import { checkDetail, checkFromRun, describeCheck, type LeanCheckRun } from "./lean/check";
import { extractStatement, frozenObjection, protocolObjection } from "./lean/rules";
import { describeRejection, excerpt, pristineType, verifyText, type LeanRun } from "./lean/verify";
import type { ChatMessage, ModelProvider } from "./model/provider";
import { prepare, type Lemma, type PrepareEvent } from "./prepare";
import { applyRenames, unknownNames } from "./lean/mathlib-index";
import { closeByAutomation, sweep } from "./lean/analysis";

/** The sweep's tactics (core/lean/analysis.ts SWEEP_SUITE), for the trace. */
const SWEEP_NAMES = "rfl, assumption, decide, omega, norm_num, simp, linarith, positivity, ring, simp_all, nlinarith, tauto, then aesop, grind, exact?";
import { dropDeadTactics } from "./lean/repair";

export type AttemptOutcome = "refused" | "no verdict" | "errors" | "sorries" | "rejected" | "verified";

export type ProveEvent =
  | { type: "status"; message: string }
  | {
      type: "attempt";
      n: number;
      candidate: string;
      outcome: AttemptOutcome;
      detail: string;
      ms: number;
      tokens: number;
      model?: string;
      /** When the model was asked (ms since 1970). */
      at?: number;
      promptTokens?: number;
      /** The model's whole reply, and its thinking when the provider returns it apart. */
      reply?: string;
      reasoning?: string;
      /** The reply stopped at the token limit. */
      truncated?: boolean;
    }
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
  /** For names Lean did not know, the one real Mathlib name each almost certainly meant (none when unclear): tried before the model revises. */
  rename?: (unknown: string[]) => Promise<Record<string, string>>;
  /**
   * Models trained for Lean (DeepSeek-Prover, Kimina, Goedel) that write the attempts; `model` then only plans.
   * With several, the chains take them in turn: different models fail on different problems, so a mix solves more.
   */
  provers?: { provider: ModelProvider; model: string }[];
  /** Feedback rounds one chain gets before it starts over from a clean conversation (0: never). Many short independent tries beat one long one. */
  revisions?: number;
  /** Verified proofs of similar statements, shown to every attempt as worked examples. */
  examples?: string;
  /** Anything else every attempt is told: a plan in words and a critic's notes on it (core/research.ts). */
  notes?: string;
  /** Premise selection: the Mathlib theorems likely to help prove this statement, as a note for every attempt; empty for none. */
  premises?: (frozen: string) => Promise<string>;
  /**
   * Try Lean's automation on the statement before any model call (one Lean run), and on every `sorry` an attempt
   * leaves (default on). The sorry sweep needs the quick check (`check`, the REPL): without it, each tactic would
   * reload Mathlib, so the sorries go back to the model instead.
   */
  automation?: boolean;
  /**
   * Mack's own repairs of a candidate before Lean judges it: lemma names Mathlib does not have, and tactics left after
   * their goal closed (default on). Off for pass@k, where the model's proof is checked exactly as it wrote it.
   */
  repair?: boolean;
  /**
   * The longest reply a model may write (default 8k tokens, 16k for prover models). Pass@k raises it, as the labs give
   * reasoning models room to think: a reply cut off loses a problem the model would have solved.
   */
  maxTokens?: number;
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

/** The task without Lean's automation behind it: every step must be proved, as in pass@k, where the file is checked as written. */
const SYSTEM_STRICT = SYSTEM.split("\n")
  .filter((l) => !l.includes("may be left as `sorry`"))
  .join("\n")
  .replace("- Never use", "- Every step must be proved: a `sorry` fails the attempt.\n- Never use");

/** The same task in the plain form prover models (DeepSeek-Prover, Kimina, Goedel) are trained on. */
export const PROVER_TASK = (frozen: string, notes: string) =>
  `Complete the following Lean 4 code:\n\n\`\`\`lean4\n${frozen}\`\`\`\n\nKeep everything before \`:=\` exactly as given. Do not use \`axiom\` or \`native_decide\`. Before producing the Lean 4 code to formally prove the given theorem, provide a detailed proof plan outlining the main proof steps and strategies.${notes ? `\n\n${notes}` : ""}`;

/** The last ```lean block of a reply, or the whole reply when it has none. */
export function extractLean(reply: string): string {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const blocks = [...cleaned.matchAll(/```(?:lean4?|)\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return (blocks.length > 0 ? blocks[blocks.length - 1] : cleaned).trim() + "\n";
}

/** Attempts stream (the pieces are not shown): a reply that stalls is then noticed within minutes, not after the whole call's limit. */
const streamQuietly = () => undefined;

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
    // Every tactic of the sweep in one Lean run: without the REPL, one Mathlib load instead of one per tactic.
    const closed = await closeByAutomation(o.frozen, quick).catch(() => null);
    if (closed && !o.signal?.aborted) {
      const verdict = await verifyText(o.frozen, pristine.type, closed, o.run);
      if (verdict.ok) {
        o.onEvent({ type: "attempt", n: 0, candidate: closed, outcome: "verified", detail: "closed by Lean's automation, no model call", ms: Date.now() - t0, tokens: 0 });
        return o.onEvent({ type: "solved", n: 0, proof: closed, axioms: verdict.axioms });
      }
      o.onEvent({ type: "status", message: `Lean's automation closed the statement, but the verifier refused it: ${describeRejection(verdict.rejection)}` });
    } else if (!o.signal?.aborted) {
      o.onEvent({ type: "status", message: `Lean's automation did not close the statement (tried, in one run: ${SWEEP_NAMES}); asking the model.` });
    }
  }
  const premises = o.premises ? await o.premises(o.frozen).catch(() => "") : "";
  const notes = [o.notes, prep.notes, o.examples, premises].filter(Boolean).join("\n\n");
  const provers = o.provers?.length ? o.provers : null;
  let chainNo = 0;

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
  // With several prover models, every one of them gets a chain.
  const chainCount = provers ? Math.min(Math.max(chains, provers.length), o.maxAttempts) : chains;

  const chain = async () => {
    const writer = provers ? provers[chainNo++ % provers.length] : { provider: o.provider, model: o.model };
    const isProver = !!provers;
    const opening = (): ChatMessage[] =>
      isProver
        ? [{ role: "user", content: PROVER_TASK(o.frozen, notes) }]
        : [
            { role: "system", content: automation ? SYSTEM : SYSTEM_STRICT },
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
      let promptTokens = 0;
      let reasoning: string | undefined;
      let truncated = false;
      const at = Date.now();
      try {
        const usual = isProver ? 16384 : 8192;
        const ask = (maxTokens: number) => writer.provider.chat({ model: writer.model, messages, maxTokens, temperature: isProver ? 0.9 : 0.6, signal, onDelta: streamQuietly });
        // A provider that refuses a reply this long (above the model's own limit) is asked again with the usual one.
        const r = await ask(Math.max(usual, o.maxTokens ?? usual)).catch((e: Error) => {
          if ((o.maxTokens ?? usual) > usual && !signal.aborted && /max_tokens|max tokens|maximum.*tokens|context (length|window)|too (large|long)/i.test(e.message)) return ask(usual);
          throw e;
        });
        reply = r.content;
        tokens = r.usage?.completionTokens ?? 0;
        promptTokens = r.usage?.promptTokens ?? 0;
        reasoning = r.reasoning;
        truncated = !!r.truncated;
      } catch (e) {
        if (!signal.aborted) modelError = (e as Error).message;
        return;
      }
      if (solved) return;
      messages.push({ role: "assistant", content: reply });
      let candidate = extractLean(reply);
      const attempt = (outcome: AttemptOutcome, detail: string) =>
        emit({ type: "attempt", n, candidate, outcome, detail, ms: Date.now() - t0, tokens, model: writer.model, at, promptTokens, reply, ...(reasoning ? { reasoning } : {}), ...(truncated ? { truncated } : {}) });

      const feedback = async (): Promise<string | null> => {
        const textual = protocolObjection(statement, candidate);
        if (textual) {
          attempt("refused", textual);
          return `The checker refused the file before running Lean: ${textual}`;
        }
        emit({ type: "status", message: `${label(n)}: Lean is checking the proof…` });
        let check = await quick(candidate);
        let swept = "";
        if (automation && o.check && check.status === "sorries") {
          emit({ type: "status", message: `${label(n)}: trying Lean's automation on each sorry…` });
          const sw = await sweep(candidate, quick).catch(() => null);
          if (sw && sw.closed > 0) {
            candidate = sw.current;
            check = await quick(candidate);
            swept = sw.open ? `Lean's automation closed ${sw.closed} of the ${sw.closed + sw.open} sorries; the file below has them filled in. ` : "";
          }
        }
        // A lemma name Mathlib does not have, with one clear real name, is fixed here rather than costing an attempt.
        if (check.status === "errors" && o.rename && o.repair !== false) {
          const unknown = unknownNames(check.errors.map((e) => e.message).join("\n"));
          const renames = unknown.length ? await o.rename(unknown).catch(() => ({}) as Record<string, string>) : {};
          const renamed = Object.keys(renames).length ? applyRenames(candidate, renames) : candidate;
          if (renamed !== candidate) {
            const again = await quick(renamed);
            if (again.status !== "noVerdict" && again.errors.length < check.errors.length) {
              emit({ type: "status", message: `${label(n)}: fixed lemma names Lean did not know: ${Object.entries(renames).map(([a, b]) => `${a} → ${b}`).join(", ")}` });
              candidate = renamed;
              check = again;
            }
          }
        }
        // A tactic left after its goal closed is removed here rather than costing an attempt.
        if (check.status === "errors" && o.repair !== false) {
          const repaired = dropDeadTactics(candidate, check.errors);
          if (repaired) {
            const again = await quick(repaired);
            if (again.status !== "noVerdict" && again.errors.length < check.errors.length) {
              candidate = repaired;
              check = again;
            }
          }
        }
        if (check.status === "noVerdict") {
          attempt("no verdict", check.output);
          return `Lean gave no verdict (${excerpt(check.output)}). Try a simpler or faster proof.`;
        }
        if (check.status === "errors" || check.status === "sorries") {
          attempt(check.status, checkDetail(check));
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
      if (isProver) messages = [...opening(), ...messages.slice(-2)];
    }
  };

  await Promise.all(Array.from({ length: chainCount }, chain));
  if (solved) return;
  if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
  if (modelError && started <= chains) return o.onEvent({ type: "failed", message: `Model call failed: ${modelError}` });
  o.onEvent({ type: "failed", message: `No verified proof after ${Math.min(started, o.maxAttempts)} attempts.${modelError ? ` The last model call failed: ${modelError}` : ""}` });
}
