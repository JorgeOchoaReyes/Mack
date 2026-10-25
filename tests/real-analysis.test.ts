// Upstream's completion and (Mack's textual) sketch analysis against real Lean.
// Opt-in, like real-lean.test.ts: MACK_LEAN_WORKSPACE=%USERPROFILE%\mack-lean npm test
import { afterAll, describe, expect, it } from "vitest";
import { analyze, complete, creditScore } from "../core/lean/analysis";
import { hasRepl, replPool } from "../core/lean/repl";

const workspace = process.env.MACK_LEAN_WORKSPACE;
const pool = workspace && hasRepl(workspace) ? replPool({ workspace, size: 1, timeoutMs: 120_000 }) : undefined;
const STATEMENT = "theorem demo (a b : ℕ) (h : a ≤ b) : a < b + 1 :=";

describe.skipIf(!pool)("Lean procedures of scoring v3", () => {
  afterAll(() => pool?.stop());

  it("completes sorries with the suite", async () => {
    const file = `import Mathlib\n\n${STATEMENT} by\n  have h2 : a < b + 1 := by sorry\n  exact h2\n`;
    const r = await complete(file, pool!.check);
    expect(r.error).toBeUndefined();
    expect(r.completed).toBeDefined();
    expect(r.completed).not.toMatch(/\bsorry\b/);
  }, 900_000);

  it("finds a hollow leaf and credits a real step", async () => {
    // The leaf restates the goal: hollow, so the node scores the base.
    const hollow = `import Mathlib\n\n${STATEMENT} by\n  have key : a < b + 1 := sorry\n  exact key\n`;
    const a = await analyze(hollow, STATEMENT, pool!.check);
    expect(a.leaves).toBe(1);
    expect(a.hollow).toBe(1);
    expect(creditScore(a)).toBe(0.5);
    // A trivial step earns nothing.
    const trivial = `import Mathlib\n\n${STATEMENT} by\n  have t : (1 : ℕ) = 1 := rfl\n  have key : a < b + 1 := by\n    have := t\n    sorry\n  exact key\n`;
    const b = await analyze(trivial, STATEMENT, pool!.check);
    expect(b.closed).toBeGreaterThanOrEqual(1);
    expect(b.trivial).toBeGreaterThanOrEqual(1);
  }, 900_000);
});
