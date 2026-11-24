// The resident REPL against real Lean + Mathlib. Opt-in, like real-lean.test.ts,
// and skipped when setup has not built the REPL:
//   MACK_LEAN_WORKSPACE=%USERPROFILE%\mack-lean npm test
import { afterAll, describe, expect, it } from "vitest";
import { hasRepl, replPool } from "../core/lean/repl";
import { leanRunner } from "../core/lean/runner";
import type { ModelProvider } from "../core/model/provider";
import type { ProveEvent } from "../core/prove";
import { stepSearch } from "../core/stepsearch";

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

  it("searches step by step on real proof states, and the strict verifier accepts the script", async () => {
    const frozen = "import Mathlib\n\ntheorem step_demo : ∀ n : ℕ, n + 0 = n := by\n  sorry\n";
    // The model's steps: a wrong one, then `intro n`; then `simp` closes the goal.
    const replies = ["```lean\nexact foo_bar_baz\nintro n\n```", "```lean\nsimp\n```"];
    const provider: ModelProvider = { name: "fake", listModels: async () => [], chat: async () => ({ content: replies.shift() ?? "```lean\nrfl\n```" }) };
    const events: ProveEvent[] = [];
    await stepSearch({ frozen, provider, model: "m", session: pool!.session, run: leanRunner({ workspace: workspace!, timeoutMs: 600_000 }), maxCalls: 4, automation: false, onEvent: (e) => events.push(e) });
    const solved = events.find((e): e is Extract<ProveEvent, { type: "solved" }> => e.type === "solved");
    expect(solved, JSON.stringify(events.filter((e) => e.type !== "status")).slice(0, 2000)).toBeDefined();
    expect(solved!.proof).toContain("  intro n\n  simp\n");
    const first = events.find((e): e is Extract<ProveEvent, { type: "attempt" }> => e.type === "attempt")!;
    expect(first.detail).toContain("exact foo_bar_baz  -- error");
    expect(first.detail).toContain("intro n  -- 1 goal left");
  }, 900_000);
});
