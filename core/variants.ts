// Easier versions first: before the attempts on a hard statement, the planning
// model proposes special cases, weaker forms and the key lemma a proof would
// need; each is proved with a small budget, and the ones Lean verifies join the
// lemmas every attempt is offered. The labs' provers learn this way by training
// on variants of a problem; here the variants are proved at the time, and only
// verified ones are kept, so a false or unproved variant changes nothing.

import type { LeanCheckRun } from "./lean/check";
import { extractStatement, frozenObjection, preambleCopy, theoremName } from "./lean/rules";
import type { ModelProvider } from "./model/provider";
import { lemmaSource, type Lemma } from "./prepare";

const VARIANTS_SYSTEM = `You help prove a hard Lean 4 theorem by first proving easier statements that lead to it.
Propose up to 3 easier statements: special cases (small values, a particular case of a parameter), weaker forms (a weaker bound, one direction of an iff), or the key lemma a proof of the theorem would need.
Each must be true, stated precisely, and useful as a helper for the theorem itself.
Reply with one \`\`\`lean code block per statement. Each block is a complete file: every line before the theorem exactly as in the given file, then one \`theorem\` with a new name, proved by \`sorry\` (\`:= by sorry\`). No other text in the blocks.`;

/** The candidate variant files of a reply: each kept only if it is a usable frozen file with the original's preamble and a new theorem. */
export function parseVariants(frozen: string, reply: string, limit = 3): string[] {
  const own = theoremName(extractStatement(frozen) ?? "");
  const out: string[] = [];
  const names = new Set<string>();
  for (const m of reply.replace(/<think>[\s\S]*?<\/think>/g, "").matchAll(/```(?:lean4?)?\s*\n([\s\S]*?)```/g)) {
    const file = `${m[1].trim()}\n`;
    const name = theoremName(extractStatement(file) ?? "");
    if (!name || name === own || names.has(name) || frozenObjection(file)) continue;
    try {
      preambleCopy(frozen, file);
    } catch {
      continue;
    }
    names.add(name);
    out.push(file);
    if (out.length >= limit) break;
  }
  return out;
}

export async function easierVersions(o: {
  frozen: string;
  provider: ModelProvider;
  model: string;
  check: LeanCheckRun;
  /** Prove one variant with a small budget; its verified proof, or null. */
  prove: (frozen: string) => Promise<string | null>;
  signal?: AbortSignal;
  onStatus: (message: string) => void;
}): Promise<Lemma[]> {
  o.onStatus("Proposing easier versions of the statement to prove first…");
  let reply: string;
  try {
    reply = (
      await o.provider.chat({
        model: o.model,
        messages: [
          { role: "system", content: VARIANTS_SYSTEM },
          { role: "user", content: `The theorem:\n\`\`\`lean\n${o.frozen}\`\`\`` },
        ],
        maxTokens: 4096,
        temperature: 0.5,
        signal: o.signal,
      })
    ).content;
  } catch {
    return [];
  }
  const variants: string[] = [];
  for (const v of parseVariants(o.frozen, reply)) {
    // A variant Lean cannot even state is dropped before any attempt is spent on it.
    const c = await o.check(v);
    if (c.status === "sorries") variants.push(v);
  }
  const proved = await Promise.all(
    variants.map(async (v, k) => {
      o.onStatus(`Proving easier version ${k + 1} of ${variants.length}…`);
      const proof = await o.prove(v).catch(() => null);
      if (!proof) return null;
      // The theorem's own preamble is already in every attempt's file: only what the proof adds after it is offered.
      const copy = preambleCopy(v, proof);
      return { file: `easier version: ${theoremName(extractStatement(v) ?? "") ?? k + 1}`, source: copy ? proof.slice(copy.candidateEnd).trim() : lemmaSource(proof) };
    }),
  );
  const kept = proved.filter((x): x is Lemma => !!x);
  o.onStatus(variants.length ? `${kept.length} of ${variants.length} easier versions proved; every attempt is offered them.` : "No usable easier version was proposed.");
  return kept;
}
