// Before a proof is attempted: try to break the frozen statement. Lean's
// random tester (`plausible`, which Mathlib loads) evaluates the statement on
// random values; a counterexample it reports is a real one, so no proof can
// exist and model calls would be wasted. Finding none is evidence, never
// proof: many statements cannot be tested at all, and a test passes only the
// values it tried.

import type { LeanCheckRun } from "./check";
import { extractStatement } from "./rules";

export type StatementCheck =
  /** The tester found values that make the statement false. */
  | { verdict: "counterexample"; detail: string }
  /** It tried random values and none broke the statement. */
  | { verdict: "passed"; detail: string }
  /** It could not test this statement (no way to generate its values, or too many preconditions failed). */
  | { verdict: "untestable"; detail: string }
  /** Lean gave no answer in time. */
  | { verdict: "unknown"; detail: string };

/** The frozen file with its proof replaced by the random tester, or undefined when it has no statement. */
export function falsifyFile(frozen: string): string | undefined {
  const statement = extractStatement(frozen);
  if (!statement) return undefined;
  const end = frozen.indexOf(statement) + statement.length;
  return `${frozen.slice(0, end)} by\n  plausible\n`;
}

const firstLines = (s: string, n = 12) => s.trim().split("\n").slice(0, n).join("\n");

/** What Lean's messages say about the tester's run. */
export function readFalsify(check: { status: string; errors: { message: string }[]; output: string }): StatementCheck {
  if (check.status === "noVerdict") return { verdict: "unknown", detail: "Lean gave no verdict in time." };
  const counter = check.errors.find((e) => /found a counter-?example/i.test(e.message));
  if (counter) return { verdict: "counterexample", detail: firstLines(counter.message) };
  if (/gave up/i.test(check.output)) return { verdict: "untestable", detail: "The tester gave up: random values rarely met the statement's hypotheses." };
  if (check.errors.length) return { verdict: "untestable", detail: `The tester cannot generate values for this statement: ${firstLines(check.errors[0].message, 3)}` };
  return { verdict: "passed", detail: "Lean's random tester found no counterexample. That is evidence the statement is true, not a proof." };
}

/** Try to break the statement with Lean's random tester on the quick check. */
export async function falsify(frozen: string, check: LeanCheckRun): Promise<StatementCheck> {
  const file = falsifyFile(frozen);
  if (!file) return { verdict: "untestable", detail: "The file has no theorem statement." };
  return readFalsify(await check(file));
}

/** One line for the person and the model. */
export function describeStatementCheck(c: StatementCheck): string {
  switch (c.verdict) {
    case "counterexample":
      return `Lean's random tester found a counterexample, so the statement is false as written:\n${c.detail}`;
    case "passed":
      return c.detail;
    case "untestable":
      return `Not tested: ${c.detail}`;
    case "unknown":
      return `Not tested: ${c.detail}`;
  }
}
