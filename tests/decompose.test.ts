import { describe, expect, it } from "vitest";
import { goalAt, goalToLemma } from "../core/decompose";
import type { LeanCheck } from "../core/lean/check";
import { parseVariants } from "../core/variants";
import { trainingData } from "../core/proof-store";
import { BENCH_SETS } from "../core/bench/bench";
import { frozenObjection } from "../core/lean/rules";

describe("stating a step's goal as a lemma", () => {
  it("turns hypotheses into binders, keeps the target, and passes the named hypotheses", () => {
    const goal = "x y : ℝ\nh₀ : 0 < x\nh₁ : x ≤\n    y\ninst✝ : Fact (1 < 2)\n⊢ 0 < y";
    expect(goalToLemma(goal)).toEqual({ binders: "(x y : ℝ) (h₀ : 0 < x) (h₁ : x ≤ y) [Fact (1 < 2)]", target: "0 < y", args: ["x", "y", "h₀", "h₁"] });
  });

  it("refuses goals no lemma can state: hidden names, let-bound values, several goals", () => {
    expect(goalToLemma("x✝ : ℕ\n⊢ x✝ = x✝")).toBeNull();
    expect(goalToLemma("n : ℕ := 3\n⊢ n = 3")).toBeNull();
    expect(goalToLemma("⊢ True\n⊢ False")).toBeNull();
    expect(goalToLemma("⊢ 1 + 1 = 2")).toEqual({ binders: "", target: "1 + 1 = 2", args: [] });
  });

  it("reads the goal Lean prints at a sorry, in tactic position or in term position", async () => {
    const src = "import Mathlib\n\ntheorem t (x : ℕ) : x = x := by\n  have h : x + 0 = x := by sorry\n  rfl\n";
    const at = src.indexOf("sorry");
    const seen: string[] = [];
    const check = async (s: string): Promise<LeanCheck> => {
      seen.push(s.split("\n")[3]);
      const ok = s.includes("(trace_state; sorry)");
      return ok
        ? { status: "sorries", errors: [], sorries: [], notes: [{ line: 4, col: 2, message: "x : ℕ\n⊢ x + 0 = x" }], output: "" }
        : { status: "errors", errors: [{ line: 4, col: 0, message: "bad" }], sorries: [], output: "" };
    };
    expect(await goalAt(src, at, check)).toEqual({ goal: "x : ℕ\n⊢ x + 0 = x", term: false });
    expect(seen[0]).toContain("(trace_state; sorry)");
  });
});

describe("easier versions", () => {
  const frozen = "import Mathlib\n\nopen Real\n\ntheorem hard (n : ℕ) (h : 2 ≤ n) : n ^ 2 ≥ 2 * n := by sorry\n";
  it("keeps proposals that are usable files with the theorem's preamble and a new name", () => {
    const reply = [
      "```lean\nimport Mathlib\n\nopen Real\n\ntheorem hard_two : (2:ℕ) ^ 2 ≥ 2 * 2 := by sorry\n```",
      "```lean\nimport Mathlib\n\ntheorem no_preamble : True := by sorry\n```",
      "```lean\nimport Mathlib\n\nopen Real\n\ntheorem hard (n : ℕ) : True := by sorry\n```",
      "```lean\nimport Mathlib\n\nopen Real\n\ntheorem hard_three : (3:ℕ) ^ 2 ≥ 2 * 3 := by sorry\n```",
    ].join("\n");
    expect(parseVariants(frozen, reply).map((f) => f.match(/theorem (\S+)/)?.[1])).toEqual(["hard_two", "hard_three"]);
  });
});

describe("fine-tuning data", () => {
  it("writes one chat example per verified proof, in the prover's prompt form", () => {
    const lines = trainingData([{ statement: "theorem t : 1 + 1 = 2 :=", proof: "import Mathlib\n\ntheorem t : 1 + 1 = 2 := by norm_num\n", at: 1, frozen: "import Mathlib\n\ntheorem t : 1 + 1 = 2 := by sorry\n" }]).split("\n");
    expect(lines).toHaveLength(1);
    const ex = JSON.parse(lines[0]);
    expect(ex.messages[0]).toMatchObject({ role: "user" });
    expect(ex.messages[0].content).toContain("Complete the following Lean 4 code");
    expect(ex.messages[1].content).toContain("by norm_num");
  });
});

describe("PutnamBench", () => {
  it("ships the Putnam problems as usable frozen files, answers written in", () => {
    const set = BENCH_SETS.find((s) => s.id === "putnambench")!;
    expect(set.problems.length).toBeGreaterThan(600);
    expect(set.problems.every((p) => !frozenObjection(p.source))).toBe(true);
    const a5 = set.problems.find((p) => p.id === "putnam_1962_a5")!;
    expect(a5.source).toContain("abbrev putnam_1962_a5_solution : ℕ → ℕ := fun n : ℕ => n * (n + 1) * 2^(n - 2)");
  });
});

import { decompose } from "../core/decompose";
import type { RunResult } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import type { ProveEvent } from "../core/prove";

describe("decomposing a statement into lemmas", () => {
  // A toy Lean: a file errors when it contains BOGUS or a tactic the toy does not know, and every theorem's type reads `P`.
  const code = (s: string) => s.replace(/--.*$/gm, "");
  const run = async (src: string): Promise<RunResult> => {
    if (/BOGUS|by by|first \||aesop|grind|exact\?/.test(src)) return { kind: "refused", output: "x.lean:1:0: error: no" };
    const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
    const thm = /#print axioms (\S+)/.exec(src)?.[1];
    if (!marker || !thm) return { kind: "ok", output: "" };
    const sorry = /\bsorry\b/.test(code(src.slice(0, src.indexOf(`#print "${marker}"`))));
    return { kind: "ok", output: `${marker}\n'${thm}' depends on axioms: [${sorry ? "sorryAx" : "propext"}]\n${thm} : P\n` };
  };
  const check = async (src: string): Promise<LeanCheck> => {
    if (/BOGUS|by by|first \||aesop|grind|exact\?/.test(src)) return { status: "errors", errors: [{ line: 1, col: 0, message: "no" }], sorries: [], output: "" };
    const lines = src.split("\n");
    const traced = lines.findIndex((l) => l.includes("(trace_state; sorry)"));
    const notes = traced >= 0 ? [{ line: traced + 1, col: 0, message: `x : ℕ\n⊢ ${/have \S+ : (.*) := by/.exec(lines[traced])?.[1]}` }] : [];
    const n = (code(src).match(/\bsorry\b/g) ?? []).length;
    return { status: n ? "sorries" : "complete", errors: [], sorries: Array.from({ length: n }, () => ({ line: 1, col: 0, goal: "?" })), notes, output: "" };
  };
  const frozen = "import Mathlib\n\ntheorem main_thm (x : ℕ) : x + 0 = x := by\n  sorry\n";
  const calls: string[] = [];
  const provider: ModelProvider = {
    name: "fake",
    listModels: async () => [],
    chat: async (r: ChatRequest) => {
      const sys = r.messages[0].role === "system" ? r.messages[0].content : "";
      const user = r.messages.find((m) => m.role === "user")!.content;
      const file = /```lean4?\n([\s\S]*?)```/.exec(user)?.[1] ?? "";
      if (sys.includes("split a Lean 4 theorem")) {
        calls.push("split");
        return { content: "```lean\nimport Mathlib\n\ntheorem main_thm (x : ℕ) : x + 0 = x := by\n  have h1 : x + 0 = x := by sorry\n  exact h1\n```" };
      }
      // The theorem itself defeats every attempt; a step lemma falls to `simp`.
      calls.push(file.includes("_step") ? "step" : "main");
      return { content: `\`\`\`lean\n${file.includes("_step") ? file.replace(/sorry/, "simp") : file.replace(/sorry/, "BOGUS")}\`\`\`` };
    },
  };

  it("proves the steps as lemmas and assembles a proof the verifier accepts", async () => {
    const events: ProveEvent[] = [];
    await decompose({ frozen, provider, model: "m", run, check, maxAttempts: 2, lemmaAttempts: 2, maxDepth: 1, rounds: 1, onEvent: (e) => events.push(e) });
    const solved = events.find((e): e is Extract<ProveEvent, { type: "solved" }> => e.type === "solved");
    expect(solved, JSON.stringify(events.filter((e) => e.type !== "status"))).toBeDefined();
    expect(calls).toEqual(["main", "main", "split", "step"]);
    expect(solved!.proof).toContain("theorem main_thm_step1 (x : ℕ) :\n    x + 0 = x := by\n  simp");
    expect(solved!.proof).toContain("have h1 : x + 0 = x := by exact main_thm_step1 x");
    expect(events.some((e) => e.type === "attempt" && e.detail.startsWith("[step 1]"))).toBe(true);
  });
});
