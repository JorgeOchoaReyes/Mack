// Upstream's completion against real Lean (the sketch analysis is tests/real-sketch.test.ts).
// Opt-in, like real-lean.test.ts: MACK_LEAN_WORKSPACE=%USERPROFILE%\mack-lean npm test
import { afterAll, describe, expect, it } from "vitest";
import { complete } from "../core/lean/analysis";
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

});
