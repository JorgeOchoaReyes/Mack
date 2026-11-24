import { describe, expect, it } from "vitest";
import { benchReport, BENCH_SETS, classifyFailure, failureBreakdown, type BenchRun } from "../core/bench/bench";
import { describePremises, parseDecls, premises } from "../core/lean/mathlib-index";

describe("why a benchmark problem failed", () => {
  it("names the most common reason among its attempts", () => {
    expect(classifyFailure([{ outcome: "errors", detail: "unknown identifier 'Nat.foo'" }, { outcome: "errors", detail: "unknown constant 'bar'" }, { outcome: "errors", detail: "type mismatch" }])).toBe("names");
    expect(classifyFailure([{ outcome: "errors", detail: "error: unsolved goals\nx : ℕ ⊢ x = x" }])).toBe("gaps");
    expect(classifyFailure([{ outcome: "no verdict", detail: "lean exceeded the 60000 ms deadline" }])).toBe("timeout");
    expect(classifyFailure([{ outcome: "refused", detail: "forbidden token" }])).toBe("statement");
    expect(classifyFailure([{ outcome: "sorries", detail: "" }])).toBe("sorries");
    expect(classifyFailure([], "Model call failed: 401")).toBe("model");
    expect(classifyFailure([{ outcome: "errors", detail: "x" }], "Stopped.")).toBe("budget");
  });

  const set = BENCH_SETS[0];
  const run: BenchRun = {
    id: "7",
    set: set.id,
    startedAt: 0,
    finishedAt: 0,
    status: "done",
    config: { model: "m", prover: "p", maxAttempts: 8, parallel: 2, automation: true, revisions: 4, method: "decompose", premises: true },
    sample: [set.problems[0].id, set.problems[1].id, set.problems[2].id],
    budget: 2,
    results: [
      { id: set.problems[0].id, outcome: "solved", attempts: 0, ms: 1000, usd: 0, proof: "…" },
      { id: set.problems[1].id, outcome: "failed", attempts: 8, ms: 60000, usd: 0.2, failure: "names", outcomes: { errors: 8 }, lastError: "unknown identifier 'Nat.foo'", lastCandidate: "theorem x := by\n  exact Nat.foo" },
      { id: set.problems[2].id, outcome: "failed", attempts: 8, ms: 60000, usd: 0.2, failure: "names", outcomes: { errors: 8 } },
    ],
  };

  it("groups unsolved problems by reason", () => {
    expect(failureBreakdown(run.results)).toEqual([{ kind: "names", count: 2, ids: [set.problems[1].id, set.problems[2].id] }]);
  });

  it("writes a report with the settings, the reasons and each unsolved problem's statement, feedback and attempt", () => {
    const md = benchReport(run, set, "0.2.18");
    expect(md).toContain("1/3 solved (33.3%)");
    expect(md).toContain("Method: decompose; model m; prover p");
    expect(md).toContain("**Wrong lemma names**: 2");
    expect(md).toContain(`### ${set.problems[1].id}: Wrong lemma names`);
    expect(md).toContain("unknown identifier 'Nat.foo'");
    expect(md).toContain("exact Nat.foo");
    expect(md).toContain(set.problems[1].source.split("\n").find((l) => l.startsWith("theorem"))!);
  });
});

describe("premise selection", () => {
  const decls = parseDecls(
    `namespace Nat
theorem choose_symm_diff {n k : ℕ} (h : k ≤ n) : n.choose (n - k) = n.choose k := sorry
theorem succ_le_of_lt {n m : ℕ} (h : n < m) : n + 1 ≤ m := sorry
def choose : ℕ → ℕ → ℕ := sorry
end Nat
namespace Real
theorem sqrt_le_sqrt {x y : ℝ} (h : x ≤ y) : √x ≤ √y := sorry
def sqrt (x : ℝ) : ℝ := x
end Real
theorem abs_sub_comm (a b : ℝ) : |a - b| = |b - a| := sorry
`,
    "Mathlib.Test",
  );

  it("finds the theorems about the statement's functions and notation", () => {
    const names = premises(decls, "theorem t (n : ℕ) : Nat.choose n 2 ≤ n ^ 2 := by", 5).map((d) => d.name);
    expect(names[0]).toBe("Nat.choose_symm_diff");
    expect(names).not.toContain("Real.sqrt_le_sqrt");
    expect(premises(decls, "theorem t (x : ℝ) (h : 0 ≤ x) : √x ≤ |x| + 1 := by", 5).map((d) => d.name)).toEqual(expect.arrayContaining(["Real.sqrt_le_sqrt", "abs_sub_comm"]));
    expect(premises(decls, "theorem t : True := by")).toEqual([]);
    expect(describePremises(premises(decls, "theorem t (x : ℝ) : √x = √x := by"))).toContain("Real.sqrt_le_sqrt");
  });
});

import { benchShare, benchSlug } from "../core/bench/bench";

describe("sharing a run as a pull request", () => {
  it("names the folder by set, method and time, and puts the report and data in it", () => {
    const set = BENCH_SETS[0];
    const run: BenchRun = {
      id: "9",
      set: set.id,
      startedAt: Date.UTC(2026, 10, 24, 1, 2),
      finishedAt: 1,
      status: "done",
      config: { model: "acct/models/big", prover: "a/p1, b/p2", maxAttempts: 8, parallel: 2, automation: true, revisions: 4, method: "decompose" },
      sample: [set.problems[0].id],
      budget: 0,
      results: [{ id: set.problems[0].id, outcome: "failed", attempts: 8, ms: 1, usd: 0.5, failure: "timeout" }],
    };
    expect(benchSlug(run)).toBe("minif2f-test-decompose-202611240102");
    const s = benchShare(run, set, "0.2.18", "someone");
    expect(Object.keys(s.files)).toEqual(["REPORT.md", "run.json"]);
    expect(s.title).toBe("Benchmark: miniF2F test 0/1 (0%), decompose, big + p1, p2");
    expect(s.body).toContain("- Lean timed out: 1");
    expect(JSON.parse(s.files["run.json"]).id).toBe("9");
  });
});
