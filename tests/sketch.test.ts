// Upstream's unit tests of sketch.rs, ported, and the score of scoring.rs.
import { describe, expect, it } from "vitest";
import { bullets, offsetOf, parseGoal, parseStatement, parseStep, parseTryThis, sketchScore, sorryIsTactic, type Analysis } from "../core/lean/sketch";

describe("sketch analysis: text utilities (upstream tests)", () => {
  it("parses steps, goals and statements from text", () => {
    expect(parseStep("have hqb' : e q ∈ f b := ⟨q, hqb, rfl⟩")).toEqual({ kind: "have", name: "hqb'", statement: "e q ∈ f b", byMode: false });
    const block = parseStep("have hne : Nonempty (ℚ ≃ ℕ+) := by\n    apply nonempty_equiv_of_countable")!;
    expect(block.byMode && block.statement === "Nonempty (ℚ ≃ ℕ+)").toBe(true);
    expect(parseStep("have : ∀ x : ℕ, x = x := fun _ => rfl")).toMatchObject({ name: "this", statement: "∀ x : ℕ, x = x" });
    expect(parseStep("obtain ⟨m, hm⟩ : ∃ m, m ≤ n ∧ n ≤ m := ⟨n, le_rfl, le_rfl⟩")).toMatchObject({ kind: "obtain", name: "⟨m, hm⟩" });
    expect(parseStep("obtain ⟨q, hq⟩ := h")).toBeUndefined();
    expect(parseStep("haveI : Fact p := ⟨hp⟩")).toBeUndefined();
    expect(parseStep("exact h")).toBeUndefined();

    const goal = parseGoal("case right\nhne : Nonempty (ℚ ≃ ℕ+)\ne : ℚ ≃ ℕ+ := Classical.choice hne\na b : ℝ\nh :\n  ∀ (x : ℝ),\n    x = x\n⊢ e q ∉ f a");
    expect(goal.hyps[0][0]).toEqual(["hne"]);
    expect(goal.hyps[1]).toEqual([["e"], "ℚ ≃ ℕ+ := Classical.choice hne"]);
    expect(goal.hyps[2][0]).toEqual(["a", "b"]);
    expect(goal.hyps[3][1]).toBe("\n  ∀ (x : ℝ),\n    x = x");
    expect(goal.target).toBe("e q ∉ f a");

    expect(parseStatement("theorem putnam_1962_b2\n: ∃ f : ℝ → Set ℕ+, ∀ a b : ℝ, a < b → f a ⊂ f b :=", "putnam_1962_b2")).toEqual(["", "∃ f : ℝ → Set ℕ+, ∀ a b : ℝ, a < b → f a ⊂ f b"]);
    expect(parseStatement("theorem t (n : ℕ) (h : 0 < n) : n ≠ 0 :=", "t")).toEqual(["(n : ℕ) (h : 0 < n)", "n ≠ 0"]);
    expect(bullets("by\n  constructor\n  · intro n\n    exact n\n\n  · simp\n")).toEqual([
      [
        { line: 3, column: 2 },
        { line: 4, column: 11 },
      ],
      [
        { line: 6, column: 2 },
        { line: 6, column: 8 },
      ],
    ]);
    expect(parseTryThis([{ severity: "info", pos: { line: 0, column: 0 }, data: "Try this:\n  [apply] exact nonempty_equiv_of_countable" }])).toBe("exact nonempty_equiv_of_countable");
  });

  it("tells a tactic sorry from a term sorry, and counts columns in codepoints", () => {
    const text = "theorem t : P := by\n  have h : Q := by\n    sorry\n  have g : R :=\n    sorry\n  exact ⟨sorry, h⟩\n  · sorry\n  refine ?_ <;> sorry";
    expect(sorryIsTactic(text, { line: 3, column: 4 })).toBe(true);
    expect(sorryIsTactic(text, { line: 5, column: 4 })).toBe(false);
    expect(sorryIsTactic(text, { line: 6, column: 9 })).toBe(false);
    expect(sorryIsTactic(text, { line: 7, column: 4 })).toBe(true);
    expect(sorryIsTactic(text, { line: 8, column: 16 })).toBe(true);
    const at = offsetOf(text, { line: 6, column: 9 });
    expect(text.slice(at, at + 5)).toBe("sorry");
  });

  it("scores as upstream's scoring v3", () => {
    const a = (closed: number, open: number, hollow: boolean): Analysis => ({
      status: "sorries",
      leaves: [],
      steps: [],
      counts: { closed, closed_with_bullets: closed, closed_leaf_used: closed, open, untestable: 0 },
      hollow,
      false_leaf: false,
      restates_root: false,
      statement_type_identical: true,
      truncated: false,
      suite: "",
      elapsed_ms: 0,
    });
    expect(sketchScore(undefined)).toBe(0.5);
    expect(sketchScore(a(0, 1, true))).toBe(0.5);
    expect(sketchScore(a(0, 1, false))).toBe(0.5);
    expect(sketchScore(a(0, 0, false))).toBe(0.5);
    expect(sketchScore(a(9, 1, true))).toBe(0.5);
    expect(sketchScore(a(1, 9, false))).toBeCloseTo(0.54);
    expect(sketchScore(a(1, 3, false))).toBeCloseTo(0.6);
  });
});
