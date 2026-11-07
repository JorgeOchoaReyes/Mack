// How the chat reached a proof: every write, check and verifier verdict that
// touched one statement and the proof files tried against it, in order. Built
// from the chat's own tool results, so it shows what happened, not a retelling.

import type { StoredMessage } from "./agent";

export type PathStep = {
  kind: "statement" | "draft" | "check" | "verify";
  /** true: it passed; false: Lean refused it; null: nothing to pass (a write). */
  ok: boolean | null;
  title: string;
  /** The tool's own report, shortened. */
  detail: string;
  /** The file text written, for a write. */
  code?: string;
  file: string;
  at: number;
};

export type ProofPath = { file: string; steps: PathStep[]; proof?: string };

const clean = (v: unknown) => (typeof v === "string" && v ? v.replace(/\\/g, "/").replace(/^\.\//, "") : undefined);
const short = (s: string, max = 1200) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** The path to `file`'s proof across these chats' messages, oldest first. */
export function proofPath(sessions: StoredMessage[][], file: string): ProofPath {
  const results = sessions
    .flatMap((ms) => ms.flatMap((m) => (m.role === "tool" ? m.results.map((r) => ({ r, at: m.at })) : [])))
    .sort((a, b) => a.at - b.at);
  // The proof files tried against this statement, whatever they were called.
  const proofs = new Set(results.filter(({ r }) => r.name === "verify_lean" && clean(r.args.statement_path) === file).map(({ r }) => clean(r.args.proof_path)!).filter(Boolean));
  const written = new Map<string, string>();
  const steps: PathStep[] = [];
  let proof: string | undefined;
  for (const { r, at } of results) {
    const path = clean(r.args.path);
    if (r.name === "write_file" && path && (path === file || proofs.has(path)) && r.ok && typeof r.args.content === "string") {
      const draft = path !== file;
      written.set(path, r.args.content);
      const n = steps.filter((s) => s.kind === (draft ? "draft" : "statement")).length + 1;
      steps.push({ kind: draft ? "draft" : "statement", ok: null, title: draft ? `Proof attempt ${n}` : n === 1 ? "Stated the theorem" : "Rewrote the statement", detail: `Wrote ${path}`, code: r.args.content, file: path, at });
    } else if (r.name === "check_lean" && path && (path === file || proofs.has(path))) {
      const ok = r.ok && /^errors: 0$/m.test(r.output);
      steps.push({ kind: "check", ok, title: ok ? "Lean compiled it" : "Lean found errors", detail: short(r.output), file: path, at });
    } else if (r.name === "verify_lean" && clean(r.args.statement_path) === file) {
      const ok = r.ok && r.output.startsWith("accepted");
      const p = clean(r.args.proof_path) ?? "";
      if (ok && written.has(p)) proof = written.get(p);
      steps.push({ kind: "verify", ok, title: ok ? "Verifier accepted the proof" : "Verifier rejected it", detail: short(r.output), file: p, at });
    }
  }
  return { file, steps, proof };
}
