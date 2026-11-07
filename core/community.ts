// Community proofs: results Mack users proved and shared in the Mack repo,
// under community/proofs/<slug>/. Each entry is a frozen statement, the proof
// Lean accepted, and a short write-up. CI checks every entry again with the
// same strict verifier (scripts/verify-community.ts) before it can be merged,
// so an entry never rests on the contributor's word.

export const COMMUNITY_REPO = { owner: "JorgeOchoaReyes", repo: "Mack" } as const;
export const COMMUNITY_DIR = "community/proofs";
/** The only files an entry may hold; CI rejects anything else. */
export const ENTRY_FILES = ["Statement.lean", "Proof.lean", "README.md", "entry.json"] as const;

export type EntryMeta = {
  theorem: string;
  /** The statement's description, in its author's words. */
  summary?: string;
  /** The Mack problem it came from. */
  problem?: string;
  contributor: string;
  /** How Mack verified it before sharing. */
  verifiedBy: "verify_lean" | "proof_run";
  /** The path that led to it: how many attempts, and how often Lean refused one. */
  attempts?: number;
  rejected?: number;
  sharedAt: string;
};

export type Entry = { slug: string; files: Record<(typeof ENTRY_FILES)[number], string> };

/** A folder name for a theorem: lower-case words joined by dashes. */
export function entrySlug(theorem: string): string {
  const s = theorem
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return s || "proof";
}

/** A slug not among `taken`: the plain one, else with -2, -3, …. */
export function freeSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

const nl = (s: string) => (s.endsWith("\n") ? s : `${s}\n`);

export function buildEntry(o: { slug: string; statement: string; proof: string; meta: EntryMeta }): Entry {
  const m = o.meta;
  const path =
    m.attempts !== undefined
      ? `Found after ${m.attempts} proof attempt${m.attempts === 1 ? "" : "s"}${m.rejected ? `; the verifier rejected ${m.rejected} before accepting this one` : ""}.`
      : m.verifiedBy === "proof_run"
        ? "Found by a Mack proof run."
        : "";
  const readme = [
    `# \`${m.theorem}\``,
    "",
    m.summary ?? "",
    "",
    "| | |",
    "|---|---|",
    `| Statement | [Statement.lean](Statement.lean) (frozen, proved by \`sorry\`) |`,
    `| Proof | [Proof.lean](Proof.lean) |`,
    m.problem ? `| From the problem | ${m.problem.replace(/\|/g, "\\|")} |` : "",
    `| Shared by | @${m.contributor} |`,
    `| Checked | by Mack's strict verifier (${m.verifiedBy === "proof_run" ? "a proof run" : "in the chat"}), and again by this repo's CI |`,
    "",
    path,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
  return {
    slug: o.slug,
    files: {
      "Statement.lean": nl(o.statement),
      "Proof.lean": nl(o.proof),
      "README.md": nl(readme),
      "entry.json": `${JSON.stringify(m, null, 2)}\n`,
    },
  };
}

export function communityPrBody(e: Entry, meta: EntryMeta): string {
  return [
    `Adds \`${meta.theorem}\` to the community proofs, shared from Mack.`,
    "",
    meta.summary ? `> ${meta.summary}` : "",
    "",
    `Files: \`${COMMUNITY_DIR}/${e.slug}/\` (${ENTRY_FILES.join(", ")}).`,
    "",
    "The **Community proofs** check builds this proof against Mathlib and runs Mack's strict verifier on it: the statement must be unchanged, with no `sorry` and only standard axioms. Merge only when that check passes.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}
