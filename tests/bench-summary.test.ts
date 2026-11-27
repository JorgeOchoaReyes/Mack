import { describe, expect, it } from "vitest";
import { BENCH_SETS, pickSample, type BenchRun } from "../core/bench/bench";
import { incompleteReason, runSummary } from "../core/bench/summary";

const set = BENCH_SETS[0];
const sample = pickSample(set, 3);
const run: BenchRun = {
  id: "s",
  set: set.id,
  startedAt: 0,
  finishedAt: 1,
  status: "done",
  config: { model: "acct/model", provider: "cheaperinference", maxAttempts: 32, parallel: 8, automation: false, revisions: 1, protocol: "passk" },
  sample,
  budget: 3,
  results: [
    { id: sample[0], outcome: "solved", attempts: 3, ms: 60_000, usd: 0.1, proof: "…" },
    { id: sample[1], outcome: "failed", attempts: 32, ms: 120_000, usd: 0.4, failure: "gaps" },
    { id: sample[2], outcome: "skipped", attempts: 0, ms: 0, usd: 0, message: "the run's budget is spent" },
  ],
};

describe("the job summary of a cloud run", () => {
  it("says what ran, the score, why problems failed and every problem's result", () => {
    const md = runSummary(run, "Benchmark run", { prices: "acct/model $0.1/$0.4 per million tokens" });
    expect(md).toContain("**1/3 solved (33.3%)** · pass@32");
    expect(md).toContain("| Model | acct/model (cheaperinference) |");
    expect(md).toContain("| Prices | acct/model $0.1/$0.4 per million tokens |");
    expect(md).toContain("- Tactics did not close goals: 1");
    expect(md).toContain(`| ${sample[2]} | ⏭️ skipped |`);
  });

  it("explains why no pull request was opened, and names a spent budget", () => {
    expect(incompleteReason(run)).toMatch(/^the budget ran out: 1 problem was skipped/);
    expect(runSummary(run, "x")).toContain("> ⚠️ Not complete: the budget ran out");
    const done = { ...run, results: run.results.slice(0, 2).concat({ ...run.results[1], id: sample[2] }) };
    expect(incompleteReason(done)).toBe("");
    expect(runSummary(done, "x", { pr: "https://github.com/o/r/pull/1" })).toContain("> ✅ Complete: https://github.com/o/r/pull/1");
  });

  it("gives the review pull request the whole run, and says when the budget cut it short", async () => {
    const { prBody } = await import("../scripts/bench-finish");
    const cut = prBody(run, "SHARE BODY", incompleteReason(run));
    expect(cut).toMatch(/^> \[!WARNING\]\n> \*\*Incomplete: the budget ran out/);
    expect(cut).toContain(`| ${sample[2]} | ⏭️ skipped |`);
    expect(cut).toContain("Before merging");
    expect(cut.trim().endsWith("SHARE BODY")).toBe(true);
    const ok = prBody(run, "SHARE BODY", "");
    expect(ok).toMatch(/^> \[!NOTE\]\n> Opened for review/);
    expect(ok).toContain("✅ Every problem has a result.");
  });
});

import { problemInWords, problemOrigin } from "../core/bench/bench";
import { buildSite } from "../core/bench/site";

describe("a problem in words", () => {
  it("gives miniF2F's informal statement, with a bare LaTeX answer marked as mathematics", () => {
    expect(problemInWords("mathd_algebra_107")).toContain("Find the radius of the circle");
    expect(problemInWords("amc12_2001_p5")).toMatch(/Show that it is \$\\text\{\(D\)\}.*\$\.$/);
  });

  it("reads PutnamBench's docstring of the theorem, not of its answer", () => {
    const src = "import Mathlib\n\n/-- the answer -/\nabbrev putnam_2000_a1_solution : ℕ := 1\n\n/--\nShow that 1 = 1.\n-/\ntheorem putnam_2000_a1 : 1 = 1 :=\nsorry\n";
    expect(problemInWords("putnam_2000_a1", src)).toBe("Show that 1 = 1.");
    expect(problemInWords("unknown", "theorem unknown : True := by sorry")).toBe("");
  });

  it("names where a problem comes from, and links the original when it is public", () => {
    expect(problemOrigin("amc12a_2002_p13")).toEqual({ label: "AMC 12A 2002, Problem 13", url: "https://artofproblemsolving.com/wiki/index.php/2002_AMC_12A_Problems/Problem_13" });
    expect(problemOrigin("putnam_1962_a1")).toEqual({ label: "Putnam 1962, A1" });
    expect(problemOrigin("induction_12dvd4expnp1p20")).toBeNull();
  });

  it("is on the problem's page, above the attempts, with the Lean statement folded away", () => {
    const id = "amc12_2001_p5";
    const site = buildSite([{ ...run, folder: "f", sample: [id], results: [{ id, outcome: "solved", attempts: 1, ms: 1, usd: 0, proof: "…" }] }], "https://github.com/o/r");
    const page = site[`runs/f/${id}.html`];
    expect(page).toContain('<div class="card statement">What is the product of all positive odd integers');
    expect(page).toContain("As given to the model, in Lean");
    expect(page).toContain("katex");
    expect(page.indexOf("The problem")).toBeLessThan(page.indexOf("How it went"));
  });
});
