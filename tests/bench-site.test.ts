import { describe, expect, it } from "vitest";
import { attemptKinds, attemptsDataset, benchReport, benchShare, BENCH_SETS, errorHead, topErrors, type BenchRun } from "../core/bench/bench";
import { buildSite, withAttempts } from "../core/bench/site";

const set = BENCH_SETS[0];
const [p0, p1] = set.problems;
const run: BenchRun = {
  id: "42",
  set: set.id,
  startedAt: Date.UTC(2026, 10, 24),
  finishedAt: 1,
  status: "done",
  config: { model: "acct/big", prover: "x/prover-a, y/prover-b", maxAttempts: 4, parallel: 2, automation: true, revisions: 4, method: "single", premises: true },
  sample: [p0.id, p1.id],
  budget: 0,
  results: [
    { id: p0.id, outcome: "solved", attempts: 2, ms: 1000, usd: 0.01, proof: "…", log: [
      { n: 1, outcome: "errors", kind: "names", model: "x/prover-a", ms: 5, tokens: 9, detail: "lean exited with 1:\n/tmp/a/Probe.lean:4:8: error(lean.unknownIdentifier): Unknown identifier `Nat.foo`", candidate: "c1" },
      { n: 2, outcome: "verified", kind: "verified", model: "y/prover-b", ms: 5, tokens: 9, detail: "", candidate: "c2" },
    ] },
    { id: p1.id, outcome: "failed", attempts: 2, ms: 2000, usd: 0.02, failure: "names", log: [
      { n: 1, outcome: "errors", kind: "names", model: "x/prover-a", ms: 5, tokens: 9, detail: "/tmp/b/Probe.lean:6:2: error(lean.unknownIdentifier): Unknown identifier `Nat.bar`", candidate: "c3" },
      { n: 2, outcome: "errors", kind: "gaps", model: "y/prover-b", ms: 5, tokens: 9, detail: "/tmp/b/Probe.lean:7:2: error: unsolved goals <x> & y", candidate: "c4" },
    ], timeline: [{ t: 1, message: "Trying Lean's automation…" }] },
  ],
};

describe("the attempt log", () => {
  it("reads Lean's message without its path", () => {
    expect(errorHead("lean exited with 1:\n/tmp/a/Probe.lean:4:8: error(lean.unknownIdentifier): Unknown identifier `Nat.foo`")).toBe("Unknown identifier `Nat.foo`");
  });

  it("is a dataset of every attempt, with its problem, model, outcome and reason", () => {
    const lines = attemptsDataset(run).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ run: "42", problem: p0.id, solved: true, n: 1, kind: "names", model: "x/prover-a", error: "Unknown identifier `Nat.foo`" });
    expect(lines[3]).toMatchObject({ problem: p1.id, solved: false, kind: "gaps" });
  });

  it("counts every attempt by kind, and groups the errors that cost the most attempts", () => {
    expect(attemptKinds(run)).toEqual([{ kind: "names", count: 2 }, { kind: "verified", count: 1 }, { kind: "gaps", count: 1 }]);
    expect(topErrors(run)[0]).toEqual({ error: "Unknown identifier `…`", count: 2, problems: 2 });
    const md = benchReport(run, set);
    expect(md).toContain("## All 4 attempts by how they ended");
    expect(md).toContain("| Unknown identifier `…` | 2 | 2 |");
  });

  it("goes into a shared run as attempts.jsonl when asked, and stays out of run.json either way", () => {
    const withLogs = benchShare(run, set, "0.2.19", "me", { logs: true });
    expect(Object.keys(withLogs.files)).toEqual(["REPORT.md", "run.json", "attempts.jsonl"]);
    const shared = JSON.parse(withLogs.files["run.json"]);
    expect(shared).toMatchObject({ sharedBy: "me", appVersion: "0.2.19", attemptsLogged: true });
    expect(shared.results[1].log).toBeUndefined();
    expect(shared.results[1].timeline).toHaveLength(1);
    const without = benchShare(run, set, "0.2.19", "me");
    expect(Object.keys(without.files)).toEqual(["REPORT.md", "run.json"]);
    expect(JSON.parse(without.files["run.json"]).results[1].timeline).toBeUndefined();
  });
});

describe("the benchmark site", () => {
  it("lists runs best first and gives each a page, with every attempt when the dataset is there", () => {
    const shared = JSON.parse(benchShare(run, set, "0.2.19", "me", { logs: true }).files["run.json"]);
    const worse = { ...shared, id: "43", results: shared.results.map((r: { outcome: string }) => ({ ...r, outcome: "failed", failure: "gaps" })) };
    const site = buildSite(
      [{ ...worse, folder: "b-run" }, withAttempts({ ...shared, folder: "a-run" }, attemptsDataset(run))],
      "https://github.com/o/r",
    );
    // Each run has a page, and each problem with an attempt log has its own.
    expect(Object.keys(site).sort()).toEqual(["index.html", "runs/a-run.html", ...run.results.map((r) => `runs/a-run/${r.id}.html`).sort(), "runs/b-run.html"].sort());
    const index = site["index.html"];
    expect(index.indexOf("runs/a-run.html")).toBeLessThan(index.indexOf("runs/b-run.html"));
    expect(index).toContain("BEST");
    expect(index).toContain("big + prover-a, prover-b");
    const page = site["runs/a-run.html"];
    expect(page).toContain("All 4 attempts by how they ended");
    expect(page).toContain("attempts.jsonl");
    // Lean's text is escaped, never markup.
    expect(page).toContain("unsolved goals &lt;x&gt; &amp; y");
    expect(page).not.toContain("<x>");
  });
});

describe("error lines", () => {
  it("drop the file position whether or not a severity follows it, and skip empty ones", () => {
    expect(errorHead("/tmp/x/Probe.lean:12:2: lean exceeded the 60000 ms deadline")).toBe("lean exceeded the 60000 ms deadline");
    expect(errorHead("/tmp/x/Probe.lean:12:2: \n/tmp/x/Probe.lean:13:2: error: unsolved goals")).toBe("unsolved goals");
    expect(errorHead("C:\\Users\\j\\AppData\\Local\\Temp\\mack-lean-1\\Probe.lean:3:1: error: type mismatch")).toBe("type mismatch");
  });
});

import { headToHead, runMetrics, splitReply } from "../core/bench/bench";

describe("run metrics and head to head", () => {
  it("measures a run from its results and every attempt, model by model", () => {
    const m = runMetrics(run);
    expect(m).toMatchObject({ solved: 1, tried: 2, rate: 0.5, attempts: 4, attemptsPerSolve: 2, completionTokens: 36 });
    expect(m.byModel).toEqual([
      { model: "x/prover-a", attempts: 2, verified: 0, completionTokens: 18, promptTokens: 0, ms: 10, truncated: 0 },
      { model: "y/prover-b", attempts: 2, verified: 1, completionTokens: 18, promptTokens: 0, ms: 10, truncated: 0 },
    ]);
  });

  it("puts two runs head to head on the problems both tried", () => {
    const other = { results: [{ ...run.results[0], outcome: "failed" as const }, { ...run.results[1], outcome: "solved" as const }] };
    expect(headToHead(run, other)).toEqual({ both: [], onlyA: [run.results[0].id], onlyB: [run.results[1].id], neither: [] });
  });

  it("separates a reply's thinking and prose from its proof", () => {
    expect(splitReply("<think>try induction</think>Plan: induct.\n```lean\ntheorem t := by simp\n```\nDone.", "apart")).toEqual({ thinking: "apart\n\ntry induction", prose: "Plan: induct.\n\nDone." });
  });
});

import { timelineOf } from "../core/bench/bench";

describe("a problem's attempt timeline", () => {
  const log = [
    { n: 2, outcome: "errors", kind: "names" as const, model: "a/m", at: "2026-11-24T10:00:30.000Z", ms: 5, tokens: 1200, detail: "P.lean:3:1: error: Unknown identifier `Nat.bar`", candidate: "c2", thinking: "maybe bar" },
    { n: 1, outcome: "errors", kind: "names" as const, model: "a/m", at: "2026-11-24T10:00:00.000Z", ms: 5, tokens: 1000, detail: "P.lean:3:1: error: Unknown identifier `Nat.foo`", candidate: "c1" },
    { n: 3, outcome: "verified", kind: "verified" as const, model: "b/p", at: "2026-11-24T10:02:05.000Z", ms: 5, tokens: 900, detail: "", candidate: "c3" },
  ];

  it("orders attempts by time, from the first, and points a repeated error back to its first", () => {
    const rows = timelineOf({ log });
    expect(rows.map((r) => [r.n, r.offsetMs, r.label, r.repeats])).toEqual([
      [1, 0, "Wrong lemma names", undefined],
      [2, 30_000, "Wrong lemma names", 1],
      [3, 125_000, "Verified", undefined],
    ]);
    expect(rows[1].error).toBe("Unknown identifier `Nat.bar`");
  });

  it("gives each problem with a log its own page on the site, linked from the run", () => {
    const one = { ...run, results: [{ ...run.results[1], log }] };
    const site = buildSite([{ ...one, folder: "r1" }], "https://github.com/o/r");
    const page = site[`runs/r1/${run.results[1].id}.html`];
    expect(page).toContain("(same as #1)");
    expect(page).toContain("maybe bar");
    expect(page).toContain("+2m05s");
    expect(site["runs/r1.html"]).toContain(`href="r1/${run.results[1].id}.html"`);
  });
});

import { BENCH_BASICS } from "../core/bench/bench";

describe("the basics of reading a run", () => {
  it("appear in every report and on the site", () => {
    expect(BENCH_BASICS.length).toBeGreaterThan(5);
    expect(benchReport(run, set)).toContain("## How to read this report");
    expect(benchReport(run, set)).toContain("**Solved.** Lean's strict verifier accepted the proof");
    expect(buildSite([{ ...run, folder: "r" }], "https://github.com/o/r")["index.html"]).toContain("How to read these results");
  });
});
