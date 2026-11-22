// Every proof Lean's strict verifier accepted, kept across projects, so a new
// attempt can see how similar statements were proved before: the retrieval
// the labs' provers get from their training data, here from the person's own
// solved problems. Only verified proofs go in, and a statement is never shown
// its own proof (a benchmark rerun must not read its answer).

import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { words } from "./lean/mathlib-index";
import { extractStatement } from "./lean/rules";
import { PROVER_TASK } from "./prove";

export type StoredProof = { statement: string; proof: string; at: number; source?: string; frozen?: string };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const MAX_PROOF = 3000;

export class ProofStore {
  private cache: StoredProof[] | null = null;

  constructor(private readonly file: string) {}

  all(): StoredProof[] {
    if (this.cache) return this.cache;
    const out: StoredProof[] = [];
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        try {
          if (line.trim()) out.push(JSON.parse(line) as StoredProof);
        } catch {
          // A torn line is skipped.
        }
      }
    }
    return (this.cache = out);
  }

  /** Keep a verified proof of `frozen`'s theorem (once per statement and proof). */
  async add(frozen: string, proof: string, source?: string, now = Date.now()): Promise<void> {
    const statement = squash(extractStatement(frozen) ?? "");
    if (!statement) return;
    if (this.all().some((p) => p.statement === statement && p.proof === proof)) return;
    const entry: StoredProof = { statement, proof, at: now, frozen, ...(source ? { source } : {}) };
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(entry)}\n`, "utf8");
    this.all().push(entry);
  }

  /** The stored proofs whose statements share the most words with `frozen`'s, never its own. */
  similar(frozen: string, k = 3): StoredProof[] {
    const statement = squash(extractStatement(frozen) ?? "");
    if (!statement) return [];
    const mine = new Set(words(statement));
    const seen = new Set<string>();
    return this.all()
      .filter((p) => p.statement !== statement)
      .map((p) => {
        const theirs = new Set(words(p.statement));
        let shared = 0;
        for (const w of theirs) if (mine.has(w)) shared++;
        return { p, s: shared / (mine.size + theirs.size - shared || 1) };
      })
      .filter((x) => x.s >= 0.2)
      .sort((a, b) => b.s - a.s || b.p.at - a.p.at)
      .filter((x) => (seen.has(x.p.statement) ? false : (seen.add(x.p.statement), true)))
      .slice(0, k)
      .map((x) => x.p);
  }
}

/** Similar proofs as the attempts read them; empty when there are none. */
export function describeExamples(found: StoredProof[]): string {
  if (!found.length) return "";
  const parts = found.map((p, i) => `Example ${i + 1}, verified by Lean earlier:\n\`\`\`lean\n${p.proof.length > MAX_PROOF ? `${p.proof.slice(0, MAX_PROOF)}\n-- …` : p.proof.trimEnd()}\n\`\`\``);
  return `Proofs of similar statements that Lean accepted before. They are examples of what works in this Mathlib, not part of the problem:\n\n${parts.join("\n\n")}`;
}

/**
 * The kept proofs as fine-tuning data: one JSON line per proof, a user turn
 * with the problem in the form prover models are trained on and an assistant
 * turn with the verified proof. The chat format that Fireworks, Together and
 * OpenAI-compatible fine-tuning services accept.
 */
export function trainingData(proofs: StoredProof[]): string {
  return proofs
    .map((p) => {
      const frozen = p.frozen ?? `import Mathlib\n\n${p.statement} by\n  sorry\n`;
      return JSON.stringify({ messages: [{ role: "user", content: PROVER_TASK(frozen, "") }, { role: "assistant", content: `\`\`\`lean4\n${p.proof.trimEnd()}\n\`\`\`` }] });
    })
    .join("\n");
}
