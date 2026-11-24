import { describe, expect, it } from "vitest";
import { harnessOf } from "../core/bench/bench";
import { helperLemmas, relevantLemmas } from "../core/bench/pool";

const proof = `import Mathlib

theorem sq_bound (a b : ℝ) : 2 * a * b ≤ a ^ 2 + b ^ 2 := by
  nlinarith [sq_nonneg (a - b)]

lemma open_step (x : ℕ) : x = x := by
  sorry

theorem main_thm (a b : ℝ) (h : a = b) : 2 * a * b ≤ a ^ 2 + b ^ 2 := by
  exact sq_bound a b
`;

const FROZEN = "import Mathlib\n\ntheorem main_thm (a b : ℝ) (h : a = b) : 2 * a * b ≤ a ^ 2 + b ^ 2 := by\n  sorry\n";

describe("the run-wide lemma pool", () => {
  it("keeps a verified proof's finished helper lemmas, not its main theorem", () => {
    const pool = helperLemmas(proof, FROZEN, "p1");
    expect(pool).toHaveLength(1);
    expect(pool[0].source).toBe("theorem sq_bound (a b : ℝ) : 2 * a * b ≤ a ^ 2 + b ^ 2 := by\n  nlinarith [sq_nonneg (a - b)]");
    expect(pool[0].file).toBe("p1 (proved earlier in this run)");
  });

  it("offers a later problem only the lemmas related to it", () => {
    const pool = helperLemmas(proof, FROZEN, "p1");
    expect(relevantLemmas(pool, "import Mathlib\n\ntheorem q (x y : ℝ) : 2 * x * y ≤ x ^ 2 + y ^ 2 := by\n  sorry\n")).toHaveLength(1);
    expect(relevantLemmas(pool, "import Mathlib\n\ntheorem q (s : Finset ℕ) : s.card = s.card := by\n  sorry\n")).toHaveLength(0);
  });

  it("is named in the harness, so runs with and without it are not compared as equals", () => {
    const config = { model: "m", maxAttempts: 4, parallel: 1, automation: true, revisions: 0, method: "single" as const };
    expect(harnessOf({ ...config, lemmaPool: true }, "1", "abc").procedures).toContain("run-wide lemma pool");
    expect(harnessOf(config, "1", "abc").procedures).not.toContain("run-wide lemma pool");
    expect(harnessOf({ ...config, method: "steps" }, "1", "abc").procedures).toContain("step-by-step search");
  });
});
