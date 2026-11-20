// What happens before the first proof attempt, shared by the single prover and
// the search tree. Three things the strongest provers do and a single loop
// did not:
//  - try to break the statement first (core/lean/falsify.ts): a counterexample
//    means no proof exists, so no model call is spent;
//  - have the model prove it in words first: a plan of small steps, which
//    every attempt is then given (informal-first, as Aristotle and
//    DeepSeek-Prover work from an informal proof);
//  - offer the lemmas this project has already proved, to copy in.
// Nothing here decides anything about the proof: only the verifier does.

import { describeStatementCheck, falsify, type StatementCheck } from "./lean/falsify";
import type { LeanCheckRun } from "./lean/check";
import type { ModelProvider } from "./model/provider";

export type PrepareEvent = { type: "statementCheck"; check: StatementCheck } | { type: "idea"; text: string };

/** A lemma a verifier accepted in this project: its file and the Lean source of the proof, preamble removed. */
export type Lemma = { file: string; source: string };

export type PrepareOptions = {
  frozen: string;
  provider: ModelProvider;
  model: string;
  /** The quick check, for the random tester; no test without it. */
  check?: LeanCheckRun;
  /** Try to break the statement with Lean's random tester first. */
  checkStatement: boolean;
  /** Ask for a proof in words first. */
  idea: boolean;
  lemmas?: Lemma[];
  signal?: AbortSignal;
  onEvent: (e: PrepareEvent | { type: "status"; message: string }) => void;
};

export const IDEA_SYSTEM = `You are a research mathematician planning a proof that someone else will write in Lean 4 with Mathlib.
Before any Lean is written, explain how to prove the statement:
1. The idea of the proof, in two or three sentences.
2. The proof as numbered steps, each a claim small enough to become one \`have\` in Lean, and for each the Mathlib lemmas or tactics likely to close it (\`omega\`, \`linarith\`, \`nlinarith\`, \`positivity\`, \`norm_num\`, \`simp\`, \`decide\`, induction, …).
If you believe the statement is false as written, begin with \`FALSE:\` and give a counterexample or the reason.
At most 350 words. Do not write a Lean file.`;

const MAX_LEMMA_CHARS = 12_000;

/** The project's verified lemmas as one note for the prover, newest first, within a size limit. */
export function lemmaNote(lemmas: Lemma[]): string {
  const shown: string[] = [];
  let size = 0;
  for (const l of lemmas) {
    const block = `-- from ${l.file}\n${l.source.trim()}`;
    if (size + block.length > MAX_LEMMA_CHARS) break;
    shown.push(block);
    size += block.length;
  }
  if (!shown.length) return "";
  const more = lemmas.length > shown.length ? ` (the ${shown.length} newest of ${lemmas.length})` : "";
  return `Lemmas a verifier already accepted in this project${more}. You may copy any of them, with its whole proof, into your file as a helper lemma before the theorem; rename it if its name clashes:\n\`\`\`lean\n${shown.join("\n\n")}\n\`\`\``;
}

/** A verified proof file as a lemma: the file without its import and option lines. */
export function lemmaSource(proof: string): string {
  return proof
    .split("\n")
    .filter((l) => !/^\s*(import|set_option)\b/.test(l))
    .join("\n")
    .trim();
}

/** The idea of a reply: the text without the model's thinking. */
const idea = (reply: string) => reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 4000);

/**
 * Run the steps before the first attempt. `stop` is set when the statement is
 * shown false; `notes` is what every attempt is told (the idea and the lemmas).
 */
export async function prepare(o: PrepareOptions): Promise<{ stop?: string; notes: string }> {
  if (o.checkStatement && o.check) {
    o.onEvent({ type: "status", message: "Trying to break the statement with Lean's random tester…" });
    const check = await falsify(o.frozen, o.check);
    o.onEvent({ type: "statementCheck", check });
    if (check.verdict === "counterexample") return { stop: describeStatementCheck(check), notes: "" };
  }
  const notes: string[] = [];
  if (o.idea && !o.signal?.aborted) {
    o.onEvent({ type: "status", message: "The model is planning the proof in words first…" });
    try {
      const r = await o.provider.chat({
        model: o.model,
        messages: [
          { role: "system", content: IDEA_SYSTEM },
          { role: "user", content: `\`\`\`lean\n${o.frozen.trimEnd()}\n\`\`\`` },
        ],
        maxTokens: 4096,
        temperature: 0.3,
        signal: o.signal,
      });
      const text = idea(r.content);
      if (text) {
        o.onEvent({ type: "idea", text });
        notes.push(`A plan for the proof, written in words before any Lean (it may be wrong; Lean decides):\n${text}`);
      }
    } catch (e) {
      // Without a plan the attempts still run; a call that was stopped stops them too.
      if (o.signal?.aborted) return { notes: "" };
      o.onEvent({ type: "status", message: `No plan in words (${(e as Error).message}); proving without one.` });
    }
  }
  const lemmas = lemmaNote(o.lemmas ?? []);
  if (lemmas) notes.push(lemmas);
  return { notes: notes.join("\n\n") };
}
