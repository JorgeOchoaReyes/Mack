// "Show me": a guided walk through a whole proof Lean accepted, one step at a
// time, each with plain words, a small worked example and a picture. The
// model writes the explanation and picks each picture from a fixed set of
// kinds Mack draws itself (no model-written code runs); Lean checked the
// proof, not the explanation, and the player says so. A walkthrough is kept
// in the problem folder (.mack/showme/) next to the proof it explains, and
// is reused until that proof changes.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Visual =
  | { type: "grid"; n: number; k?: number; caption?: string }
  | { type: "bars"; values: number[]; labels?: string[]; highlight?: number[]; caption?: string }
  | { type: "equation"; before: string; after: string; caption?: string }
  | { type: "induction"; upTo: number; base?: string; step?: string; caption?: string }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "none" };

export type WalkStep = {
  title: string;
  /** What this step does and why, in plain words. */
  explain: string;
  /** The proof's lines this step covers, 1-based and inclusive. */
  lines?: [number, number];
  /** In a whole-problem walkthrough: the file the step is about (its `lines` are in that file). */
  file?: string;
  /** What is still left to show once this step is done. */
  goal?: string;
  /** The step on a small case, e.g. n = 3. */
  example?: string;
  visual: Visual;
};

/** One proved result in the map of a whole problem: what it does there and which results it builds on. */
export type MapNode = { file: string; title: string; role: string; uses: string[] };

export type Walkthrough = {
  /** Whole-problem walkthroughs: how the proved results fit together. */
  map?: MapNode[];
  /** The whole proof's idea in two or three sentences. */
  idea: string;
  steps: WalkStep[];
  /** What to remember from it. */
  takeaway?: string;
};

export type StoredWalkthrough = {
  file: string;
  theorem?: string;
  /** Hash of the proof it explains: a changed proof needs a new walkthrough. */
  proofHash: string;
  proof: string;
  /** Whole-problem walkthroughs (`file` is "*"): every proof it explains, by file. */
  proofs?: Record<string, string>;
  model: string;
  createdAt: number;
  walkthrough: Walkthrough;
};

export const proofHash = (proof: string) => createHash("sha256").update(proof.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
const storePath = (root: string, file: string) => join(root, ".mack", "showme", `${createHash("sha256").update(file).digest("hex").slice(0, 16)}.json`);

export async function readWalkthrough(root: string, file: string): Promise<StoredWalkthrough | null> {
  try {
    return JSON.parse(await readFile(storePath(root, file), "utf8")) as StoredWalkthrough;
  } catch {
    return null;
  }
}

export async function saveWalkthrough(root: string, w: StoredWalkthrough): Promise<void> {
  await mkdir(join(root, ".mack", "showme"), { recursive: true });
  await writeFile(storePath(root, w.file), JSON.stringify(w, null, 2), "utf8");
}

export const SHOWME_PROMPT = `You explain a Lean 4 proof that Lean has already accepted, to a person with no training in Lean and little in mathematics. They will step through your explanation one step at a time, with a picture beside each step.

Reply with one JSON object and nothing else:
{
  "idea": "the whole proof's idea in two or three plain sentences",
  "steps": [
    {
      "title": "a short name for the step, at most 8 words",
      "explain": "what this step does and why it works, in plain words, 2 to 5 sentences; name any Lean tactic and say what it does",
      "lines": [first, last],
      "goal": "what is still left to prove after this step, in ordinary math notation, or \\"nothing: the proof is complete\\"",
      "example": "this step on a small case, with actual numbers, e.g. n = 3",
      "visual": { ... }
    }
  ],
  "takeaway": "one or two sentences to remember"
}

Rules:
- Cover the whole proof from the first line after := to the end, in order, in 3 to 10 steps. Every proof line belongs to exactly one step. "lines" are the numbers shown at the left of the proof.
- Start with a step that says what is being claimed (lines: the theorem statement) before the proof steps.
- Explain the mathematics, not only the tactics: what the induction is on, what the base case and the step say, why an algebraic step is true.
- Use real numbers in "example" and in the visuals and get them right: compute them carefully.
- "visual" is exactly one of these kinds; pick the one that best shows the step:
  {"type":"grid","n":4,"k":2,"caption":"..."}  an n by n grid of unit squares; with k, it marks where the k by k squares can sit. Use for counting squares or cells. n at most 10.
  {"type":"bars","values":[1,4,9,16],"labels":["1²","2²","3²","4²"],"highlight":[3],"caption":"..."}  the terms of a sum as bars, with their total; highlight marks the indices to stress (0-based). At most 12 values.
  {"type":"equation","before":"...","after":"...","caption":"..."}  an expression before and after a rewrite or simplification.
  {"type":"induction","upTo":4,"base":"P(0): 0 = 0","step":"P(k) ⇒ P(k+1)","caption":"..."}  a chain of cases 0, 1, …, upTo: the base case proved, each case giving the next. upTo at most 8.
  {"type":"table","columns":["n","left side","right side"],"rows":[["1","1","1"],["2","5","5"]],"caption":"..."}  a small table of values. At most 8 rows, 5 columns; all cells are strings.
  {"type":"none"}
- Plain text only inside strings: no Markdown, no LaTeX. Write powers as ², ³ or ^ and sums with Σ or "1 + 2 + … + n".`;

export function showmeRequest(o: { theorem?: string; summary?: string; problem?: string; proof: string }): string {
  const numbered = o.proof
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3)}  ${l}`)
    .join("\n");
  return [
    o.problem ? `The person's question: ${o.problem}` : "",
    o.theorem ? `Theorem: ${o.theorem}` : "",
    o.summary ? `Its description: ${o.summary}` : "",
    "The accepted proof, with line numbers:",
    "```lean",
    numbered,
    "```",
  ]
    .filter(Boolean)
    .join("\n");
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined);

function visual(raw: unknown): Visual {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const caption = str(v.caption, 200);
  switch (v.type) {
    case "grid": {
      const n = int(v.n, 1, 10);
      if (!n) break;
      const k = int(v.k, 1, n);
      return { type: "grid", n, ...(k ? { k } : {}), caption };
    }
    case "bars": {
      const values = Array.isArray(v.values) ? v.values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).slice(0, 12) : [];
      if (!values.length) break;
      const labels = Array.isArray(v.labels) ? v.labels.slice(0, values.length).map((x) => String(x).slice(0, 12)) : undefined;
      const highlight = Array.isArray(v.highlight) ? v.highlight.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < values.length) : undefined;
      return { type: "bars", values, labels, highlight, caption };
    }
    case "equation": {
      const before = str(v.before, 300);
      const after = str(v.after, 300);
      if (!before || !after) break;
      return { type: "equation", before, after, caption };
    }
    case "induction": {
      const upTo = int(v.upTo, 1, 8);
      if (!upTo) break;
      return { type: "induction", upTo, base: str(v.base, 120), step: str(v.step, 120), caption };
    }
    case "table": {
      const columns = Array.isArray(v.columns) ? v.columns.slice(0, 5).map((x) => String(x).slice(0, 30)) : [];
      const rows = Array.isArray(v.rows) ? v.rows.slice(0, 8).filter(Array.isArray).map((r) => (r as unknown[]).slice(0, columns.length).map((x) => String(x).slice(0, 40))) : [];
      if (!columns.length || !rows.length) break;
      return { type: "table", columns, rows, caption };
    }
  }
  return { type: "none" };
}

/** The walkthrough in a model's reply, checked and trimmed to what the player can show; throws when there is none. */
export function parseWalkthrough(text: string, proofLines: number | Record<string, number>): Walkthrough {
  const files = typeof proofLines === "number" ? undefined : proofLines;
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the model did not reply with a walkthrough");
  const raw = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 14).flatMap((s): WalkStep[] => {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const title = str(o.title, 120);
    const explain = str(o.explain, 1500);
    if (!title || !explain) return [];
    let lines: [number, number] | undefined;
    if (Array.isArray(o.lines) && o.lines.length >= 1) {
      const max = files ? (files[String(o.file)] ?? 0) : (proofLines as number);
      const a = max ? int(o.lines[0], 1, max) : undefined;
      const b = max ? int(o.lines[o.lines.length - 1], 1, max) : undefined;
      if (a && b) lines = [Math.min(a, b), Math.max(a, b)];
    }
    const file = files && typeof o.file === "string" && o.file in files ? o.file : undefined;
    return [{ title, explain, lines: files && !file ? undefined : lines, ...(file ? { file } : {}), goal: str(o.goal, 400), example: str(o.example, 600), visual: visual(o.visual) }];
  });
  if (!steps.length) throw new Error("the walkthrough had no steps");
  const map = files && Array.isArray(raw.map)
    ? raw.map.flatMap((m): MapNode[] => {
        const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
        const file = typeof o.file === "string" && o.file in files ? o.file : undefined;
        if (!file) return [];
        const uses = Array.isArray(o.uses) ? o.uses.filter((u): u is string => typeof u === "string" && u in files && u !== file) : [];
        return [{ file, title: str(o.title, 80) ?? file, role: str(o.role, 300) ?? "", uses }];
      })
    : undefined;
  return { idea: str(raw.idea, 800) ?? "", ...(map?.length ? { map } : {}), steps, takeaway: str(raw.takeaway, 500) };
}

export const SHOWME_ALL_PROMPT = `You explain how several Lean 4 results, each already accepted by Lean, together answer one question. The reader has no training in Lean and little in mathematics. They will step through your explanation one step at a time, with a picture beside each step, and first see a map of how the results depend on each other.

Reply with one JSON object and nothing else:
{
  "idea": "how the results together answer the question, in two to four plain sentences",
  "map": [ { "file": "the file, exactly as given", "title": "a short name, at most 5 words", "role": "what this result contributes to the answer, one sentence", "uses": ["files whose results this one relies on, exactly as given"] } ],
  "steps": [
    {
      "file": "the file this step is about, exactly as given",
      "title": "a short name for the step, at most 8 words",
      "explain": "what this step does and why it works, in plain words, 2 to 5 sentences; when moving to a new result, say how it connects to the previous one",
      "lines": [first, last],
      "goal": "what is still left to show at this point, in ordinary math notation",
      "example": "this step on a small case, with actual numbers",
      "visual": { ... }
    }
  ],
  "takeaway": "one or two sentences: the answer to the question, and what to remember"
}

Rules:
- Put every result in the map. Order the steps so a result comes after the results it uses, and end with the one that most directly answers the question.
- Walk through every result: for each, one step for its claim and then its proof's main moves, 2 to 4 steps per result and at most 16 steps in all. "lines" are the line numbers shown in that file.
- Explain the mathematics, not only the tactics, and say how each result connects to the others and to the question. Where two results prove the same thing in different forms, say so plainly.
- Use real numbers in "example" and in the visuals and get them right.
- "visual" is exactly one of these kinds:
  {"type":"grid","n":4,"k":2,"caption":"..."}  an n by n grid of unit squares; with k, it marks where the k by k squares can sit. n at most 10.
  {"type":"bars","values":[1,4,9,16],"labels":["1²","2²","3²","4²"],"highlight":[3],"caption":"..."}  the terms of a sum as bars with their total; highlight is 0-based. At most 12 values.
  {"type":"equation","before":"...","after":"...","caption":"..."}  an expression before and after a rewrite.
  {"type":"induction","upTo":4,"base":"...","step":"...","caption":"..."}  cases 0 to upTo, each giving the next. upTo at most 8.
  {"type":"table","columns":["n","left","right"],"rows":[["1","1","1"]],"caption":"..."}  at most 8 rows, 5 columns, string cells.
  {"type":"none"}
- Plain text only inside strings: no Markdown, no LaTeX.`;

export function showmeAllRequest(o: { question: string; goal?: string; items: { file: string; theorem?: string; summary?: string; proof: string }[] }): string {
  const parts = o.items.map((it) => {
    const numbered = it.proof
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l, i) => `${String(i + 1).padStart(3)}  ${l}`)
      .join("\n");
    return [`## File: ${it.file}`, it.theorem ? `Theorem: ${it.theorem}` : "", it.summary ? `Description: ${it.summary}` : "", "```lean", numbered, "```"].filter(Boolean).join("\n");
  });
  return [`The person's question: ${o.question}`, o.goal ? `The goal as written in their plan: ${o.goal}` : "", `${o.items.length} results Lean accepted:`, ...parts].filter(Boolean).join("\n\n");
}

/** One hash for a set of proofs: the whole-problem walkthrough is rewritten when any of them changes. */
export const proofsHash = (proofs: Record<string, string>) => proofHash(Object.keys(proofs).sort().map((f) => `${f}\n${proofs[f]}`).join("\n\0\n"));
