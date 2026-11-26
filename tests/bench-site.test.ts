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
    // Each run has a page, each problem with attempts, steps or a proof has its own, and so does each model setup.
    expect(Object.keys(site).sort()).toEqual(["index.html", "models/big-prover-a-prover-b.html", "runs/a-run.html", ...run.results.map((r) => `runs/a-run/${r.id}.html`).sort(), "runs/b-run.html", ...run.results.map((r) => `runs/b-run/${r.id}.html`)].sort());
    const index = site["index.html"];
    expect(index.indexOf("runs/a-run.html")).toBeLessThan(index.indexOf("runs/b-run.html"));
    // Two problems are a quick run: listed, never ranked.
    expect(index).not.toContain("BEST");
    // Quick runs are listed openly, marked, and not numbered.
    expect(index).toContain('<span class="pill">quick</span>');
    expect(index).toContain("A run on part of the set. Listed, not ranked");
    expect(index).not.toContain("<details class=\"quick\"");
    expect(index).toContain('href="models/big-prover-a-prover-b.html"');
    const model = site["models/big-prover-a-prover-b.html"];
    expect(model).toContain("big + prover-a, prover-b");
    expect(model).toContain("Where it fails");
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
    expect(page).toContain("(same as attempt 1)");
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

import { harnessLabel, harnessOf } from "../core/bench/bench";

describe("the harness a run used", () => {
  it("names Mack's version, the Open Math Harness commit and the procedures the settings turned on", () => {
    const h = harnessOf({ ...run.config, method: "decompose", easierFirst: true }, "0.2.21", "687f2a20dc6ff552d3c881e10910b46c13e84e2a");
    expect(h.mack).toBe("0.2.21");
    expect(h.openMathHarness).toBe("687f2a2");
    expect(h.procedures).toEqual(["strict verifier", "linters off", "dead-tactic repair", "name repair", "automation sweep", "premise selection", "easier versions first", "decompose", "prover ensemble", "restart after 4 revisions"]);
    expect(harnessLabel(h)).toBe("Mack 0.2.21 · OMH 687f2a2");
    expect(harnessLabel(undefined, "0.2.18")).toBe("Mack 0.2.18");
  });

  it("is on the report, the leaderboard and the run's page", () => {
    const marked = { ...run, harness: harnessOf(run.config, "0.2.21", "687f2a2") };
    expect(benchReport(marked, set)).toContain("- Harness: Mack 0.2.21, Open Math Harness 687f2a2; procedures: strict verifier");
    const site = buildSite([{ ...marked, folder: "h" }], "https://github.com/o/r");
    expect(site["index.html"]).toContain("0.2.21 · OMH 687f2a2");
    expect(site["runs/h.html"]).toContain("Open Math Harness <b>687f2a2</b>");
  });
});

import { METHOD_LABELS } from "../core/bench/bench";

describe("Open Math Harness's own methods in the benchmark", () => {
  it("mark a search or swarm run with only the harness's procedures, none of Mack's additions", () => {
    expect(harnessOf({ ...run.config, method: "search" }, "0.2.21", "687f2a2").procedures).toEqual(["strict verifier", "linters off", "OMH search tree"]);
    expect(harnessOf({ ...run.config, method: "ultramath" }, "0.2.21", "687f2a2").procedures).toEqual(["strict verifier", "linters off", "OMH ultramath swarm"]);
  });

  it("name the method in full in the report", () => {
    expect(benchReport({ ...run, config: { ...run.config, method: "search" } }, set)).toContain(`- Method: ${METHOD_LABELS.search};`);
    expect(METHOD_LABELS.single).toContain("Mack");
    expect(METHOD_LABELS.ultramath).toContain("Open Math Harness");
  });

  it("ranks only runs on the whole set, with a 95% range, and splits PutnamBench by year", () => {
    const whole = (id: string, solvedEvery: number): BenchRun => ({
      ...run,
      id,
      sample: set.problems.map((p) => p.id),
      results: set.problems.map((p, i) => (i % solvedEvery === 0 ? { id: p.id, outcome: "solved" as const, attempts: (i % 5) + 1, ms: 1, usd: 0.01, proof: "…" } : { id: p.id, outcome: "failed" as const, attempts: 4, ms: 1, usd: 0.01 })),
    });
    const putnam = BENCH_SETS.find((s) => s.id === "putnambench")!;
    const recent = BENCH_SETS.find((s) => s.id === "putnam-recent")!;
    expect(recent.problems.length).toBeGreaterThan(0);
    expect(recent.problems.every((p) => putnam.problems.some((q) => q.id === p.id))).toBe(true);
    const putnamRun: BenchRun = { ...run, id: "p", set: "putnambench", sample: putnam.problems.slice(0, 3).map((p) => p.id).concat(recent.problems.slice(0, 2).map((p) => p.id)), results: [...putnam.problems.slice(0, 3), ...recent.problems.slice(0, 2)].map((p, i) => ({ id: p.id, outcome: i === 0 ? ("solved" as const) : ("failed" as const), attempts: 1, ms: 1, usd: 0, ...(i === 0 ? { proof: "…" } : {}) })) };
    const site = buildSite([{ ...whole("a", 2), folder: "half" }, { ...whole("b", 4), folder: "quarter" }, { ...putnamRun, folder: "putnam" }], "https://github.com/o/r");
    const index = site["index.html"];
    expect(index).toContain("BEST");
    expect(index.indexOf("runs/half.html")).toBeLessThan(index.indexOf("runs/quarter.html"));
    expect(index).toContain("95% range");
    expect(index).toContain("Recent problems: the contamination check");
    expect(index).toMatch(/1\/3 \(33\.3%\)<\/td><td>0\/2 \(0\.0%\)/);
    const page = site["runs/half.html"];
    expect(page).toContain("Solved within k attempts");
    expect(page).toContain("within 64 attempts");
    expect(page).toContain("Self-reported by the run");
  });
});

describe("the problem deep dive", () => {
  it("explains a problem solved by automation, with the tactic that closed it", () => {
    const set = BENCH_SETS[0];
    const p = set.problems[0];
    const auto: BenchRun = {
      id: "a",
      set: set.id,
      startedAt: 0,
      finishedAt: 1,
      status: "done",
      config: { model: "x/m", maxAttempts: 4, parallel: 1, automation: true, revisions: 0 },
      sample: [p.id],
      budget: 0,
      results: [{ id: p.id, outcome: "solved", attempts: 0, ms: 90_000, usd: 0, proof: "theorem t : 1 = 1 := by\n  grind\n", timeline: [{ t: 0, message: "Trying Lean's automation…" }] }],
    };
    const site = buildSite([{ ...auto, folder: "auto" }], "https://github.com/o/r");
    const page = site[`runs/auto/${p.id}.html`];
    expect(page).toContain("Solved by automation");
    expect(page).toContain("(<code>grind</code>)");
    expect(page).toContain("before any model wrote a proof");
    expect(site["runs/auto.html"]).toContain("Time per problem");
    expect(site["runs/auto.html"]).toContain(`${p.id}: solved by automation, 1m 30s`);
  });
});
