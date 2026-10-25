// Upstream's sketch analysis (core/lean/sketch.ts) against real Lean on the resident REPL.
// Opt-in, like real-lean.test.ts: MACK_LEAN_WORKSPACE=%USERPROFILE%\mack-lean npm test
import { afterAll, describe, expect, it } from "vitest";
import { hasRepl, replPool } from "../core/lean/repl";
import { analyzeSketch, sketchScore } from "../core/lean/sketch";

const workspace = process.env.MACK_LEAN_WORKSPACE;
const pool = workspace && hasRepl(workspace) ? replPool({ workspace, size: 1, timeoutMs: 120_000 }) : undefined;
const frozenOf = (statement: string) => `import Mathlib\n\n${statement}\nsorry\n`;
const analyze = (frozen: string, file: string) => pool!.session("import Mathlib", (s) => analyzeSketch(s, frozen, file));

describe.skipIf(!pool)("sketch analysis against real Lean", () => {
  afterAll(() => pool?.stop());
  const S = "theorem demo (a b : ℕ) (h : a ≤ b) : a < b + 1 :=";

  it("finds a hollow leaf through the tactic route, after clearing the sketch's locals", async () => {
    const file = `import Mathlib\n\n${S} by\n  have t : (1 : ℕ) = 1 := rfl\n  have key : a < b + 1 := by\n    have := h\n    sorry\n  exact key\n`;
    const a = await analyze(frozenOf(S), file);
    expect(a.error).toBeUndefined();
    expect(a.status).toBe("sorries");
    expect(a.statement_type_identical).toBe(true);
    expect(a.leaves).toHaveLength(1);
    expect(a.leaves[0]).toMatchObject({ verdict: "hollow", route: "tactic" });
    const t = a.steps.find((s) => s.name === "t")!;
    expect(t.trivial_by).toBeDefined();
    expect(t.unused).toBe(true);
    expect(sketchScore(a)).toBe(0.5);
  }, 900_000);

  it("does not call a genuinely weaker leaf hollow", async () => {
    const P = "theorem demo2 (n : ℕ) (hn : 2 ≤ n) : ∃ p, Nat.Prime p ∧ n < p :=";
    const file = `import Mathlib\n\n${P} by\n  have big : ∃ p, Nat.Prime p ∧ n.factorial < p := sorry\n  obtain ⟨p, hp, hlt⟩ := big\n  exact ⟨p, hp, lt_of_le_of_lt (Nat.self_le_factorial n) hlt⟩\n`;
    const a = await analyze(frozenOf(P), file);
    expect(a.error).toBeUndefined();
    expect(a.leaves).toHaveLength(1);
    expect(a.leaves[0].verdict).not.toBe("hollow");
  }, 900_000);
});
