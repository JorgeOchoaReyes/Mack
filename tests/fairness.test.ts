import { describe, expect, it } from "vitest";
import { attemptKind, classifyFailure, errorMessages } from "../core/bench/bench";
import { checkDetail, checkFromRun } from "../core/lean/check";
import { dropDeadTactics } from "../core/lean/repair";

// The Lean output of a real putnam_1992_a2 attempt (Mack 0.2.17, macOS), trimmed.
const REAL = `lean exited with 1:
/var/folders/k9/T/mack-lean-P6fC28/Probe.lean:24:12: error: No goals to be solved
/var/folders/k9/T/mack-lean-P6fC28/Probe.lean:53:10: warning: Unused tactic linter: \`simpa using hb.rpow_const hn\` does not change the goal.

Note: This linter can be disabled with \`set_option linter.unusedTactic false\`
/var/folders/k9/T/mack-lean-P6fC28/Probe.lean:134:44: warning: this tactic is never executed

Note: This linter can be disabled with \`set_option linter.unreachableTactic false\`
/var/folders/k9/T/mack-lean-P6fC28/Probe.lean:134:25: warning: Used \`tac1 <;> tac2\` where \`(tac1; tac2)\` would suffice

Note: This linter can be disabled with \`set_option linter.unnecessarySeqFocus false\`
`;

describe("judging attempts fairly", () => {
  it("keeps linter advice out of the check, so Lean's error comes first", () => {
    const c = checkFromRun({ kind: "refused", output: REAL.replace(/^lean exited with 1:\n/, "") });
    expect(c.errors.map((e) => e.message)).toEqual(["No goals to be solved"]);
    expect(c.notes).toEqual([]);
    expect(checkDetail(c)).toBe("Probe.lean:24:12: error: No goals to be solved");
  });

  it("labels an attempt by Lean's errors only, never by words in warnings", () => {
    expect(errorMessages(REAL)).toBe("No goals to be solved");
    expect(attemptKind({ outcome: "errors", detail: REAL })).toBe("extra");
    // A warning that mentions heartbeats does not make an error a timeout.
    expect(attemptKind({ outcome: "errors", detail: "P.lean:3:1: warning: consider raising maxHeartbeats\nP.lean:4:1: error: unsolved goals\n⊢ False" })).toBe("gaps");
    expect(attemptKind({ outcome: "errors", detail: "P.lean:4:1: error: (deterministic) timeout at whnf, maximum number of heartbeats (200000)" })).toBe("timeout");
  });

  it("names Mack's own failures as Mack's, not the model's", () => {
    expect(attemptKind({ outcome: "no verdict", detail: "could not start lake: spawn lake ENOENT" })).toBe("harness");
    expect(attemptKind({ outcome: "no verdict", detail: "the REPL exited with 137" })).toBe("harness");
    expect(attemptKind({ outcome: "no verdict", detail: "lean exceeded the 600000 ms deadline" })).toBe("timeout");
    expect(classifyFailure([], "ssh could not reach box")).toBe("harness");
  });
});

describe("removing tactics left after a goal closed", () => {
  it("drops a whole line, or the tail after a combinator, and only when that is every error", () => {
    const src = "theorem t : 1 = 1 := by\n  rfl\n  simp\n  exact foo <;> ring\n";
    const errs = [
      { line: 3, col: 2, message: "No goals to be solved" },
      { line: 4, col: 16, message: "no goals to be proved" },
    ];
    expect(dropDeadTactics(src, errs)).toBe("theorem t : 1 = 1 := by\n  rfl\n  exact foo\n");
    expect(dropDeadTactics(src, [...errs, { line: 2, col: 2, message: "type mismatch" }])).toBeNull();
    expect(dropDeadTactics(src, [])).toBeNull();
  });
});
