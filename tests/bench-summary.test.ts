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
    expect(runSummary(run, "x")).toContain("> ⚠️ Not complete, so no pull request: the budget ran out");
    const done = { ...run, results: run.results.slice(0, 2).concat({ ...run.results[1], id: sample[2] }) };
    expect(incompleteReason(done)).toBe("");
    expect(runSummary(done, "x", { pr: "https://github.com/o/r/pull/1" })).toContain("> ✅ Complete: https://github.com/o/r/pull/1");
  });
});
