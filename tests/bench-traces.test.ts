import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BENCH_SETS, pickSample, tracesUrl, type BenchRun } from "../core/bench/bench";
import { problemPage } from "../core/bench/site";
import { validateRun } from "../core/bench/validate";
import { writeTraces } from "../scripts/bench-finish";

const set = BENCH_SETS[0];
const sample = pickSample(set, 2);

describe("full traces", () => {
  it("are gathered from every machine into one file per problem, attempts in order, uncut", () => {
    const from = mkdtempSync(join(tmpdir(), "traces-"));
    const long = "t".repeat(200_000);
    writeFileSync(join(from, "traces-0.jsonl"), [JSON.stringify({ problem: sample[0], n: 2, thinking: long }), JSON.stringify({ problem: "not-in-run", n: 1 }), "{torn"].join("\n"));
    writeFileSync(join(from, "traces-1.jsonl"), JSON.stringify({ problem: sample[0], n: 1, thinking: "first" }) + "\n" + JSON.stringify({ problem: sample[1], n: 1 }) + "\n");
    const out = join(from, "out");
    expect(writeTraces(from, out, sample)).toBe(3);
    const lines = readFileSync(join(out, `${sample[0]}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { n: number; thinking: string });
    expect(lines.map((l) => l.n)).toEqual([1, 2]);
    expect(lines[1].thinking).toHaveLength(200_000);
    expect(writeTraces(join(from, "missing"), out, sample)).toBe(0);
  });

  it("are linked from the run only as a Hugging Face dataset and the run's own folder", () => {
    const run = { id: "x", set: set.id, startedAt: 0, status: "done", config: { model: "m", maxAttempts: 1, parallel: 1, automation: false, revisions: 1 }, sample, budget: 0, results: sample.map((id) => ({ id, outcome: "failed", attempts: 1, ms: 1, usd: 0 })) } as unknown as BenchRun;
    const files = (traces: unknown) => ({ "run.json": JSON.stringify({ ...run, traces }) });
    const issue = (traces: unknown) => validateRun("f", files(traces)).filter((p) => p.includes("traces"));
    expect(issue({ dataset: "someone/mack-traces", path: "runs/f" })).toEqual([]);
    expect(issue({ dataset: "someone/mack-traces", path: "runs/other" })).toHaveLength(1);
    expect(issue({ dataset: "https://evil.example/x", path: "runs/f" })).toHaveLength(1);
    expect(tracesUrl({ dataset: "someone/mack-traces", path: "runs/f" }, "imo_1992_p1")).toBe("https://huggingface.co/datasets/someone/mack-traces/blob/main/runs/f/imo_1992_p1.jsonl");
    const page = problemPage({ ...run, folder: "f", traces: { dataset: "someone/mack-traces", path: "runs/f" } } as never, { ...run.results[0], log: [{ n: 1, outcome: "failed", kind: "statement", ms: 1, tokens: 1, detail: "", candidate: "" }] } as never, undefined, "https://github.com/o/r");
    expect(page).toContain('href="https://huggingface.co/datasets/someone/mack-traces/blob/main/runs/f/');
  });
});
