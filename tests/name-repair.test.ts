import { describe, expect, it } from "vitest";
import { applyRenames, renameFor, type Decl } from "../core/lean/mathlib-index";
import type { LeanCheck } from "../core/lean/check";
import type { RunResult } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import { prove, type ProveEvent } from "../core/prove";

const decl = (name: string): Decl => ({ name, kind: "theorem", sig: "", module: "M" });
const DECLS = ["Nat.add_zero", "Nat.pow_le_pow_left", "pow_le_pow_left", "Nat.Prime.two_le", "Finset.sum_range_succ", "Real.sqrt_nonneg"].map(decl);

describe("lemma names Lean did not know", () => {
  it("finds the one real name meant: another namespace, or another spelling", () => {
    expect(renameFor(DECLS, "Real.sum_range_succ")).toBe("Finset.sum_range_succ");
    expect(renameFor(DECLS, "Prime.two_le")).toBe("Nat.Prime.two_le");
    expect(renameFor(DECLS, "Real.SqrtNonneg")).toBe("Real.sqrt_nonneg");
    expect(renameFor(DECLS, "sqrt_nonneg")).toBe("Real.sqrt_nonneg");
  });

  it("guesses nothing when two real names fit equally, or none does", () => {
    // `Int.pow_le_pow_left` could be `Nat.…` or the root one: no single clear name.
    expect(renameFor(DECLS, "Int.pow_le_pow_left")).toBeNull();
    expect(renameFor(DECLS, "Nat.totally_made_up")).toBeNull();
    expect(renameFor(DECLS, "Nat.add_zero")).toBeNull();
  });

  it("replaces whole identifiers only", () => {
    const src = "exact Real.sum_range_succ f n\nhave := Real.sum_range_succ_comm\nexact h.Real.sum_range_succ";
    expect(applyRenames(src, { "Real.sum_range_succ": "Finset.sum_range_succ" })).toBe("exact Finset.sum_range_succ f n\nhave := Real.sum_range_succ_comm\nexact h.Real.sum_range_succ");
  });

  it("are fixed before the model is asked again, when Lean then agrees", async () => {
    const frozen = "import Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  sorry\n";
    const run = async (src: string): Promise<RunResult> => {
      const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
      const thm = /#print axioms (\S+)/.exec(src)?.[1];
      if (!marker || !thm) return { kind: "ok", output: "" };
      return { kind: "ok", output: `${marker}\n'${thm}' depends on axioms: [propext]\n${thm} : P\n` };
    };
    const check = async (src: string): Promise<LeanCheck> =>
      src.includes("Nat.addZero")
        ? { status: "errors", errors: [{ line: 4, col: 8, message: "Unknown identifier `Nat.addZero`" }], sorries: [], output: "" }
        : { status: "complete", errors: [], sorries: [], output: "" };
    let calls = 0;
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async (_r: ChatRequest) => {
        calls++;
        return { content: "```lean\nimport Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  exact Nat.addZero x\n```" };
      },
    };
    const events: ProveEvent[] = [];
    await prove({ frozen, provider, model: "m", run, check, maxAttempts: 3, automation: false, rename: async (names) => Object.fromEntries(names.map((n) => [n, renameFor([decl("Nat.add_zero")], n) ?? n])), onEvent: (e) => events.push(e) });
    const solved = events.find((e): e is Extract<ProveEvent, { type: "solved" }> => e.type === "solved");
    expect(solved?.proof).toContain("exact Nat.add_zero x");
    expect(calls).toBe(1);
    expect(events.some((e) => e.type === "status" && e.message.includes("Nat.addZero → Nat.add_zero"))).toBe(true);
  });
});
