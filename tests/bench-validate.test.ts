import { describe, expect, it } from "vitest";
import { BENCH_SETS, benchShare, pickSample, type BenchRun } from "../core/bench/bench";
import { validateRun } from "../core/bench/validate";

const set = BENCH_SETS[0];
const run: BenchRun = {
  id: "1",
  set: set.id,
  startedAt: 0,
  finishedAt: 1,
  status: "done",
  config: { model: "m", maxAttempts: 2, parallel: 1, automation: true, revisions: 4 },
  sample: pickSample(set, 2),
  budget: 0,
  results: [
    { id: pickSample(set, 2)[0], outcome: "solved", attempts: 1, ms: 1, usd: 0, proof: "theorem …" },
    { id: pickSample(set, 2)[1], outcome: "failed", attempts: 2, ms: 1, usd: 0, log: [{ n: 1, outcome: "errors", kind: "gaps", ms: 1, tokens: 1, detail: "x", candidate: "y", thinking: "my key is sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef" }] },
  ],
};

describe("validating a shared run before it is merged", () => {
  it("passes what a share writes, with secrets masked before upload", () => {
    const files = benchShare(run, set, "0.2.22", "me", { logs: true }).files;
    expect(files["attempts.jsonl"]).not.toContain("0123456789abcdef0123456789abcdef");
    expect(validateRun("minif2f-test-single-202611240000", files)).toEqual([]);
  });

  it("accepts the official mark only from the Mack repo's own workflow, linking its run", () => {
    const official = { ...run, official: { runner: "GitHub Actions ubuntu-latest", url: "https://github.com/JorgeOchoaReyes/Mack/actions/runs/123" } };
    const files = benchShare(official, set, "0.2.42", "").files;
    expect(JSON.parse(files["run.json"]).official.url).toContain("/actions/runs/123");
    // From a fork: refused, whatever it links.
    expect(validateRun("minif2f-test-single-202611240000", files).join()).toContain("official runs come only from the Mack repo");
    expect(validateRun("minif2f-test-single-202611240000", files, { officialAllowed: true })).toEqual([]);
    const elsewhere = benchShare({ ...official, official: { runner: "x", url: "javascript:alert(1)" } }, set, "0.2.42", "").files;
    expect(validateRun("minif2f-test-single-202611240000", elsewhere, { officialAllowed: true }).join()).toContain("must link the Mack workflow run");
  });

  it("refuses unknown files, bad folders, missing proofs, foreign problems and secrets", () => {
    const good = benchShare(run, set, "0.2.22", "me").files;
    expect(validateRun("Bad Folder", good)[0]).toContain("folder name");
    expect(validateRun("ok", { ...good, "evil.sh": "rm -rf /" })).toContain("unexpected file evil.sh: a shared run holds only REPORT.md, run.json, attempts.jsonl");
    const noProof = JSON.stringify({ ...run, results: [{ ...run.results[0], proof: undefined }] });
    expect(validateRun("ok", { ...good, "run.json": noProof }).join("\n")).toContain("solved problems without their proof");
    const foreign = JSON.stringify({ ...run, results: [{ ...run.results[1], id: "made_up_problem" }] });
    expect(validateRun("ok", { ...good, "run.json": foreign }).join("\n")).toContain("not in miniF2F test: made_up_problem");
    expect(validateRun("ok", { ...good, "REPORT.md": "token ghp_0123456789abcdefghijABCDEFGHIJ012345" }).join("\n")).toContain("looks like a secret");
    expect(validateRun("ok", { "run.json": "{" }).join("\n")).toContain("missing REPORT.md");
  });

  it("refuses a run that dropped a failure or picked its own problems", () => {
    const good = benchShare(run, set, "0.2.22", "me").files;
    const dropped = JSON.stringify({ ...run, results: [run.results[0]] });
    expect(validateRun("ok", { ...good, "run.json": dropped }).join("\n")).toContain(`problems of the sample with no result (a skipped one is still listed, as skipped): ${run.sample[1]}`);
    const picked = [set.problems[0].id, set.problems[1].id].filter((id) => !run.sample.includes(id)).slice(0, 2);
    const handPicked = JSON.stringify({ ...run, sample: [run.sample[0], picked[0]], results: [run.results[0], { ...run.results[1], id: picked[0] }] });
    expect(validateRun("ok", { ...good, "run.json": handPicked }).join("\n")).toContain("the sample is not the fixed 2 problems of miniF2F test");
    const twice = JSON.stringify({ ...run, results: [...run.results, run.results[0]] });
    expect(validateRun("ok", { ...good, "run.json": twice }).join("\n")).toContain("more than one result");
  });
});
