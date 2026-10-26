// The description of a project pull request: what changed, and what Lean
// says about it. Proofs the chat verified (`verify_lean`) are verified again
// on the files as they are when the PR is opened, so the PR states what the
// strict verifier accepts now, not what the model reported earlier.

import type { ChangedFile } from "../git";
import type { StoredMessage } from "./agent";

export type ProofPair = { statement: string; proof: string };
export type Verdict = ProofPair & { result: string };

/** The statement/proof pairs the chat ran the strict verifier on, each once, most recent last. */
export function verifiedPairs(messages: StoredMessage[]): ProofPair[] {
  const pairs = new Map<string, ProofPair>();
  for (const m of messages) {
    if (m.role !== "tool") continue;
    for (const r of m.results) {
      const statement = r.args.statement_path;
      const proof = r.args.proof_path;
      if (r.name !== "verify_lean" || typeof statement !== "string" || typeof proof !== "string") continue;
      const key = `${statement}\0${proof}`;
      pairs.delete(key);
      pairs.set(key, { statement, proof });
    }
  }
  return [...pairs.values()];
}

const STATUS: Record<ChangedFile["status"], string> = { added: "added", untracked: "added", modified: "changed", deleted: "removed", renamed: "renamed" };

export function prBody(o: { chat?: string; summary?: string; files: ChangedFile[]; verdicts: Verdict[]; lean: boolean }): string {
  const out: string[] = [];
  if (o.summary?.trim()) out.push(o.summary.trim(), "");
  out.push("## Lean verification", "");
  if (!o.lean) out.push("Lean is not set up in Mack, so nothing in this PR was verified.");
  else if (!o.verdicts.length) out.push("No proof in this PR was checked by the strict verifier. Treat every claim in it as unverified.");
  else {
    out.push("The strict verifier ran again on these files when this PR was opened:", "");
    for (const v of o.verdicts) out.push(`- \`${v.proof}\` proves \`${v.statement}\`: **${v.result.startsWith("accepted") ? "accepted" : "not accepted"}**`, `  > ${v.result.replace(/\n/g, " ")}`);
    out.push("", "Only these results come from Lean. Documents and comments in this PR are the model's writing, not checked.");
  }
  out.push("", "## Files", "");
  for (const f of o.files) out.push(`- ${STATUS[f.status]} \`${f.path}\``);
  out.push("", `_Opened from Mack${o.chat ? `, chat "${o.chat}"` : ""}._`);
  return out.join("\n");
}
