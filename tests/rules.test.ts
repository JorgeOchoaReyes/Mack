import { describe, expect, it } from "vitest";
import {
  checkForbiddenToken,
  extractStatement,
  forbiddenToken,
  frozenObjection,
  preambleCopy,
  protocolObjection,
} from "../core/lean/rules";
import { harnessReport, parseAxioms, verifyText, type LeanRun } from "../core/lean/verify";
import { extractLean } from "../core/prove";

const FROZEN = "import Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n :=\nsorry\n";

describe("textual rules (ported from upstream rules.rs)", () => {
  it("extracts the frozen statement and accepts a valid frozen file", () => {
    expect(extractStatement(FROZEN)).toBe("theorem demo (n : Nat) : n + 0 = n :=");
    expect(frozenObjection(FROZEN)).toBeUndefined();
  });

  it("refuses the two things Lean itself would not notice", () => {
    const statement = extractStatement(FROZEN)!;
    const partial = `import Mathlib\n\n${statement} by\n  have h : True := trivial\n  sorry\n`;
    expect(protocolObjection(statement, partial)).toBeUndefined();
    expect(protocolObjection(statement, partial.replace("(n : Nat)", "(n : Nat )"))).toContain("byte for byte");
    expect(protocolObjection(statement, partial.replace("trivial", "by native_decide"))).toBeDefined();
    expect(protocolObjection(statement, `axiom cheat : False\n${partial}`)).toBeDefined();
  });

  it("ignores banned words inside comments and strings, but not in code", () => {
    expect(forbiddenToken("-- no sorry left\ntheorem t : True := trivial\n")).toBeUndefined();
    expect(forbiddenToken('/- axiom native_decide -/ def s := "sorry"\n')).toBeUndefined();
    expect(forbiddenToken("theorem t : True := by sorry\n")).toBe("sorry");
    expect(checkForbiddenToken("theorem t : True := by sorry\n")).toBeUndefined();
    expect(checkForbiddenToken("#eval IO.println 1\n")).toBe("#eval");
    expect(checkForbiddenToken("set_option debug.skipKernelTC true\n")).toBe("set_option debug");
  });

  it("refuses text the lexer cannot read unambiguously", () => {
    expect(checkForbiddenToken('def s := s!"x{1}"\n')).toContain("cannot read");
    expect(checkForbiddenToken("/- never closed\n")).toContain("never closed");
  });

  it("requires the frozen preamble to be kept and followed by a command", () => {
    const frozen = "import Mathlib\n\ndef f (n : Nat) : Nat := n\n\ntheorem demo : f 1 = 1 :=\nsorry\n";
    expect(preambleCopy(frozen, "import Mathlib\ndef f (n : Nat) : Nat := n\nlemma h : True := trivial\n")).not.toBeNull();
    expect(() => preambleCopy(frozen, "import Mathlib\ndef f (n : Nat) : Nat := 1\n")).toThrow(/first line that differs/);
  });

  it("refuses unusable frozen files", () => {
    expect(frozenObjection("theorem t : True :=\nsorry\n")).toContain("import Mathlib");
    expect(frozenObjection("import Mathlib\ntheorem t : True := by\n  trivial\n")).toContain("sorry` alone");
  });
});

describe("verify protocol (ported from upstream verify.rs)", () => {
  it("parses the axioms line", () => {
    expect(parseAxioms("'demo' depends on axioms: [propext, Classical.choice]")).toEqual({
      usesSorry: false,
      axioms: ["propext", "Classical.choice"],
    });
    expect(parseAxioms("'demo' depends on axioms: [sorryAx]").usesSorry).toBe(true);
  });

  it("reads only the report after the marker", () => {
    const out = "spoof\nm1\n'demo' does not depend on any axioms\ndemo : ∀ (n : Nat), n + 0 = n\n";
    expect(harnessReport(out, "m1", "demo")?.type).toBe("demo : ∀ (n : Nat), n + 0 = n");
    expect(harnessReport(out + "m1\n", "m1", "demo")).toBeUndefined();
  });

  /** A fake Lean that prints the harness report for whatever marker the probe carries. */
  const fakeLean =
    (type: string, axioms = "does not depend on any axioms"): LeanRun =>
    async (source) => {
      const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(source)![1];
      return { kind: "ok", output: `${marker}\n'demo' ${axioms}\n${type}\n` };
    };

  const proof = "import Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n :=\nby simp\n";

  it("accepts a proof whose type matches the pristine one", async () => {
    const v = await verifyText(FROZEN, "demo : T", proof, fakeLean("demo : T"));
    expect(v.ok).toBe(true);
  });

  it("rejects a type mismatch, sorryAx and non-standard axioms", async () => {
    expect(await verifyText(FROZEN, "demo : T", proof, fakeLean("demo : U"))).toMatchObject({ ok: false, rejection: { kind: "typeMismatch" } });
    expect(await verifyText(FROZEN, "demo : T", proof, fakeLean("demo : T", "depends on axioms: [sorryAx]"))).toMatchObject({
      ok: false,
      rejection: { kind: "sorryAx" },
    });
    expect(await verifyText(FROZEN, "demo : T", proof, fakeLean("demo : T", "depends on axioms: [cheat]"))).toMatchObject({
      ok: false,
      rejection: { kind: "nonStandardAxioms" },
    });
  });

  it("treats a timeout as a rejection, never a pass", async () => {
    const v = await verifyText(FROZEN, "demo : T", proof, async () => ({ kind: "noVerdict", reason: "deadline" }));
    expect(v.ok).toBe(false);
  });
});

describe("extractLean", () => {
  it("takes the last lean block and drops thinking", () => {
    expect(extractLean("<think>```lean\nbad\n```</think>\nok:\n```lean\ngood\n```")).toBe("good\n");
  });
});
