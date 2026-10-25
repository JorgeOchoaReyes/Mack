// The resident REPL against real Lean + Mathlib. Opt-in, like real-lean.test.ts,
// and skipped when setup has not built the REPL:
//   MACK_LEAN_WORKSPACE=%USERPROFILE%\mack-lean npm test
import { afterAll, describe, expect, it } from "vitest";
import { hasRepl, replPool } from "../core/lean/repl";

const workspace = process.env.MACK_LEAN_WORKSPACE;
const pool = workspace && hasRepl(workspace) ? replPool({ workspace, size: 1, timeoutMs: 120_000 }) : undefined;

describe.skipIf(!pool)("resident REPL against real Lean", () => {
  afterAll(() => pool?.stop());

  it("reports open goals at sorry", async () => {
    const c = await pool!.check("import Mathlib\n\ntheorem demo (n : ℕ) : n + 0 = n := by\n  have h : n = n := rfl\n  sorry\n");
    expect(c.status).toBe("sorries");
    expect(c.sorries[0]).toMatchObject({ line: 5 });
    expect(c.sorries[0].goal).toContain("n + 0 = n");
  }, 900_000);

  it("reports errors with the file's own line numbers, and accepts a complete proof", async () => {
    const bad = await pool!.check("import Mathlib\n\ntheorem demo (n : ℕ) : n + 0 = n := by\n  exact foo\n");
    expect(bad.status).toBe("errors");
    expect(bad.errors[0].line).toBe(4);
    const ok = await pool!.check("import Mathlib\n\ntheorem demo (n : ℕ) : n + 0 = n := by simp\n");
    expect(ok.status).toBe("complete");
  }, 120_000);
});
