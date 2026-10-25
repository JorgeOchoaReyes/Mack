// The quick check of a partial proof, with Lean's messages kept apart: each
// error with its position, and each `sorry` with the goal left open there
// (only the resident REPL reports goals; a `lake env lean` run does not).
// A check is never a verdict on a finished proof; that is `verifyText`.

import type { RunResult } from "./verify";

export type LeanMessage = { line: number; col: number; message: string };
export type OpenGoal = { line: number; col: number; goal: string };

export type LeanCheck = {
  status: "errors" | "sorries" | "complete" | "noVerdict";
  errors: LeanMessage[];
  sorries: OpenGoal[];
  /** The raw output, for display. */
  output: string;
};

/** A source checked on a fresh `lake env lean` run or on the resident REPL. */
export type LeanCheckRun = (source: string) => Promise<LeanCheck>;

/** Parse `file:line:col: error: message` blocks of Lean's command-line output. */
export function parseCliOutput(output: string): { errors: LeanMessage[]; sorryLines: number[] } {
  const errors: LeanMessage[] = [];
  const sorryLines: number[] = [];
  const re = /^.*?:(\d+):(\d+): (error|warning|info): ([\s\S]*?)(?=^.*?:\d+:\d+: (?:error|warning|info): |(?![\s\S]))/gm;
  for (const m of output.replace(/\r\n/g, "\n").matchAll(re)) {
    const msg = m[4].trim();
    if (m[3] === "error") errors.push({ line: Number(m[1]), col: Number(m[2]), message: msg });
    else if (msg.startsWith("declaration uses 'sorry'")) sorryLines.push(Number(m[1]));
  }
  return { errors, sorryLines };
}

/** A check from a command-line run: positions of errors, and of declarations that use `sorry`, without goals. */
export function checkFromRun(r: RunResult): LeanCheck {
  if (r.kind === "noVerdict") return { status: "noVerdict", errors: [], sorries: [], output: r.reason };
  const { errors, sorryLines } = parseCliOutput(r.output);
  if (r.kind === "refused" && errors.length === 0) errors.push({ line: 0, col: 0, message: r.output.slice(0, 1500) });
  const sorries = sorryLines.map((line) => ({ line, col: 0, goal: "(goal not reported by this check)" }));
  const status = errors.length > 0 || r.kind === "refused" ? "errors" : sorries.length > 0 ? "sorries" : "complete";
  return { status, errors, sorries, output: r.output };
}

const cut = (s: string) => (s.length > 1500 ? `${s.slice(0, 1500)}…` : s);

/** The check as the model reads it: at most 12 errors and 12 open goals, each cut at 1500 characters (upstream's bounds). */
export function describeCheck(c: LeanCheck): string {
  if (c.status === "noVerdict") return `status: no verdict (${cut(c.output)})`;
  const lines = [`status: ${c.status}`, `errors: ${c.errors.length}`];
  for (const e of c.errors.slice(0, 12)) lines.push(`  - line ${e.line}, column ${e.col}: ${cut(e.message)}`);
  if (c.errors.length > 12) lines.push(`  - … and ${c.errors.length - 12} more`);
  lines.push(`remaining sorries: ${c.sorries.length}`);
  for (const s of c.sorries.slice(0, 12)) lines.push(`  - line ${s.line}, column ${s.col}; goal:\n${cut(s.goal).replace(/^/gm, "      ")}`);
  if (c.sorries.length > 12) lines.push(`  - … and ${c.sorries.length - 12} more`);
  return lines.join("\n");
}
