// The strict verify protocol as pure functions of the frozen file, the
// candidate and a way to run Lean. Ported from open-math-harness
// `program-files/lean/src/verify.rs` (Apache-2.0).
//
// A candidate is accepted only when: no forbidden token; the frozen statement
// appears verbatim; the frozen preamble is kept; Lean elaborates the file with
// no error; `#print axioms` shows no `sorryAx` and nothing beyond the three
// standard axioms; and the theorem's fully elaborated (`pp.all`) type is
// character-identical to the pristine statement's. The report is read only
// after a random per-run marker, so output the candidate prints is never read.

import { randomBytes } from "node:crypto";
import { extractStatement, forbiddenToken, preambleCopy, theoremName } from "./rules";

export const TRUSTED_AXIOMS = ["propext", "Classical.choice", "Quot.sound"];

/** What running Lean on a source produced: clean output, Lean's refusal, or no verdict at all. */
export type RunResult =
  | { kind: "ok"; output: string }
  | { kind: "refused"; output: string }
  | { kind: "noVerdict"; reason: string };

export type LeanRun = (source: string) => Promise<RunResult>;

export type Rejection =
  | { kind: "forbidden"; token: string }
  | { kind: "statementMismatch" }
  | { kind: "preambleMismatch"; reason: string }
  | { kind: "noFrozenStatement" }
  | { kind: "elaboration"; excerpt: string }
  | { kind: "sorryAx" }
  | { kind: "nonStandardAxioms"; axioms: string[] }
  | { kind: "typeMismatch" }
  | { kind: "noType" };

export type Verdict = { ok: true; axioms: string[] } | { ok: false; rejection: Rejection };

/** The command placed right after the frozen preamble, so a candidate cannot continue its last declaration. */
export const SEPARATOR = '#print "mack: the frozen preamble ends here"';

export function excerpt(s: string): string {
  return s.slice(0, 800);
}

function freshMarker(): string {
  return `mack-report-${randomBytes(16).toString("hex")}`;
}

function reportCommands(marker: string, thm: string): string {
  return `\n#print "${marker}"\n#print axioms ${thm}\nset_option pp.all true in #check @${thm}\n`;
}

/** Parse the harness's own `#print axioms` line. */
export function parseAxioms(line: string): { usesSorry: boolean; axioms: string[] } {
  const usesSorry = line.includes("sorryAx");
  const i = line.indexOf("depends on axioms: [");
  if (i === -1) return { usesSorry, axioms: [] };
  const rest = line.slice(i + "depends on axioms: [".length);
  const close = rest.indexOf("]");
  if (close === -1) return { usesSorry, axioms: [] };
  const axioms = rest
    .slice(0, close)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { usesSorry, axioms };
}

function startsWithTypeHead(text: string, thm: string): boolean {
  let rest = text.startsWith("@") ? text.slice(1) : text;
  if (!rest.startsWith(thm)) return false;
  rest = rest.slice(thm.length);
  if (rest.startsWith(".{")) {
    const close = rest.indexOf("}");
    if (close === -1 || !/^[\p{L}\p{N}_,\s]*$/u.test(rest.slice(2, close))) return false;
    rest = rest.slice(close + 1);
  }
  return rest.startsWith(" : ");
}

/**
 * The text after the one line that is exactly `marker`: one axioms line for
 * `thm` and then the `#check` type block. Undefined for any other shape.
 */
export function harnessReport(output: string, marker: string, thm: string): { axiomLine: string; type: string } | undefined {
  const normalized = output.replace(/\r\n/g, "\n");
  const line = `${marker}\n`;
  let start: number;
  if (normalized.startsWith(line)) start = 0;
  else {
    const i = normalized.indexOf(`\n${line}`);
    if (i === -1) return undefined;
    start = i + 1;
  }
  if (normalized.split(marker).length - 1 !== 1) return undefined;
  const report = normalized.slice(start + line.length);
  const nl = report.indexOf("\n");
  if (nl === -1) return undefined;
  const axiomLine = report.slice(0, nl);
  const rest = report.slice(nl + 1);
  const tail = axiomLine.startsWith(`'${thm}' `) ? axiomLine.slice(thm.length + 3) : undefined;
  const wellFormed =
    tail !== undefined &&
    (tail === "does not depend on any axioms" ||
      (tail.startsWith("depends on axioms: [") && tail.endsWith("]") && !tail.slice(20).includes("[")));
  if (!wellFormed || !startsWithTypeHead(rest, thm)) return undefined;
  return { axiomLine, type: rest.trim() };
}

/** The file verify elaborates: the frozen preamble, the separator, then the candidate after its copy of it. */
export function checkedSource(frozen: string, candidate: string): { checked: string; rest: string } {
  const copy = preambleCopy(frozen, candidate);
  if (!copy) return { checked: candidate, rest: candidate };
  const preamble = frozen.slice(0, copy.frozenEnd);
  const rest = candidate.slice(copy.candidateEnd);
  const lines = (t: string) => t.split("\n").length - 1;
  const padding = Math.max(0, lines(candidate.slice(0, copy.candidateEnd)) - lines(preamble));
  return { checked: `${preamble} ${SEPARATOR}${"\n".repeat(padding)}${rest}`, rest };
}

/** The pristine statement's elaborated type, computed once per frozen file. */
export async function pristineType(frozen: string, run: LeanRun): Promise<{ ok: true; type: string } | { ok: false; reason: string }> {
  const statement = extractStatement(frozen);
  const thm = statement && theoremName(statement);
  if (!thm) return { ok: false, reason: "the frozen file has no named `theorem … :=` statement" };
  let checked: string;
  try {
    checked = checkedSource(frozen, frozen).checked;
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const marker = freshMarker();
  const r = await run(checked + reportCommands(marker, thm));
  if (r.kind === "noVerdict") return { ok: false, reason: r.reason };
  if (r.kind === "refused" || r.output.includes("error:")) return { ok: false, reason: excerpt(r.output) };
  const report = harnessReport(r.output, marker, thm);
  if (!report) return { ok: false, reason: `Lean printed no report for \`${thm}\` after the file:\n${excerpt(r.output)}` };
  return { ok: true, type: report.type };
}

/** Decide a complete candidate against the frozen file and its pristine type. */
export async function verifyText(frozen: string, pristine: string, candidate: string, run: LeanRun): Promise<Verdict> {
  const reject = (rejection: Rejection): Verdict => ({ ok: false, rejection });
  const tok = forbiddenToken(candidate);
  if (tok) return reject({ kind: "forbidden", token: tok });
  const statement = extractStatement(frozen);
  const thm = statement && theoremName(statement);
  if (!statement || !thm) return reject({ kind: "noFrozenStatement" });
  if (!candidate.includes(statement)) return reject({ kind: "statementMismatch" });
  let checked: string;
  let rest: string;
  try {
    ({ checked, rest } = checkedSource(frozen, candidate));
  } catch (e) {
    return reject({ kind: "preambleMismatch", reason: (e as Error).message });
  }
  if (!rest.includes(statement)) return reject({ kind: "statementMismatch" });
  const tok2 = forbiddenToken(checked);
  if (tok2) return reject({ kind: "forbidden", token: tok2 });
  const marker = freshMarker();
  const r = await run(checked + reportCommands(marker, thm));
  if (r.kind === "noVerdict") return reject({ kind: "elaboration", excerpt: excerpt(r.reason) });
  if (r.kind === "refused" || r.output.includes("error:")) return reject({ kind: "elaboration", excerpt: excerpt(r.output) });
  const report = harnessReport(r.output, marker, thm);
  if (!report) return reject({ kind: "noType" });
  const { usesSorry, axioms } = parseAxioms(report.axiomLine);
  if (usesSorry) return reject({ kind: "sorryAx" });
  const extra = axioms.filter((a) => !TRUSTED_AXIOMS.includes(a));
  if (extra.length > 0) return reject({ kind: "nonStandardAxioms", axioms: extra });
  if (report.type !== pristine.trim()) return reject({ kind: "typeMismatch" });
  return { ok: true, axioms };
}

export function describeRejection(r: Rejection): string {
  switch (r.kind) {
    case "forbidden":
      return `forbidden token \`${r.token}\``;
    case "statementMismatch":
      return "the frozen theorem statement does not appear verbatim";
    case "preambleMismatch":
      return r.reason;
    case "noFrozenStatement":
      return "the frozen file has no `theorem … :=` statement";
    case "elaboration":
      return `Lean rejected the file:\n${r.excerpt}`;
    case "sorryAx":
      return "the proof still depends on `sorry`";
    case "nonStandardAxioms":
      return `the proof depends on non-standard axioms: ${r.axioms.join(", ")}`;
    case "typeMismatch":
      return "the theorem elaborates to a different type than the frozen statement";
    case "noType":
      return "Lean printed no type report for the theorem";
  }
}
