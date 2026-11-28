// What keeps benchmark runs of different models comparable: failed model calls are
// counted, the reply limit is never lowered quietly, the run's settings are tried
// once before it starts, and the served model and returned thinking are recorded.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../core/lean/verify";
import type { LeanCheck } from "../core/lean/check";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import { OpenAICompatibleProvider } from "../core/model/openai-compatible";
import { prove, type ProveEvent } from "../core/prove";
import { modelCalls, ranToEnd, sameModel, servedOthers, thinkingReturned, type BenchResult, type BenchRun } from "../core/bench/bench";
import { incompleteReason, runSummary } from "../core/bench/summary";
import { buildSite } from "../core/bench/site";
import { preflight } from "../scripts/check-model";

afterEach(() => vi.unstubAllGlobals());

const frozen = "import Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  sorry\n";
const run = async (src: string): Promise<RunResult> => {
  const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
  const thm = /#print axioms (\S+)/.exec(src)?.[1];
  return marker && thm ? { kind: "ok", output: `${marker}\n'${thm}' depends on axioms: [propext]\n${thm} : P\n` } : { kind: "ok", output: "" };
};
const wrong = async (): Promise<LeanCheck> => ({ status: "errors", errors: [{ line: 4, col: 2, message: "unsolved goals" }], sorries: [], output: "" });
const reply = "```lean\nimport Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  simp\n```";

describe("failed model calls", () => {
  it("are logged as spent attempts, and the problem goes on with fresh samples", async () => {
    let n = 0;
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async () => {
        if (++n === 2) throw new Error("Fake returned 503: overloaded");
        return { content: reply };
      },
    };
    const events: ProveEvent[] = [];
    await prove({ frozen, provider, model: "m", run, check: wrong, maxAttempts: 4, revisions: 1, automation: false, repair: false, onEvent: (e) => events.push(e) });
    const attempts = events.filter((e) => e.type === "attempt");
    expect(attempts.map((a) => a.type === "attempt" && a.outcome)).toEqual(["errors", "model error", "errors", "errors"]);
    expect(n).toBe(4);
  });

  it("end the problem after four in a row, instead of hammering a provider that is down", async () => {
    let n = 0;
    const provider: ModelProvider = { name: "fake", listModels: async () => [], chat: async () => (n++, Promise.reject(new Error("Fake returned 500"))) };
    const events: ProveEvent[] = [];
    await prove({ frozen, provider, model: "m", run, check: wrong, maxAttempts: 32, revisions: 1, automation: false, repair: false, onEvent: (e) => events.push(e) });
    expect(n).toBe(4);
    expect(events.at(-1)).toMatchObject({ type: "failed" });
  });

  it("past 5% of a run's calls, mark the run incomplete: the model had fewer real samples than k", () => {
    const res = (attempts: number, modelErrors: number): BenchResult => ({ id: `p${attempts}${modelErrors}`, outcome: "failed", attempts, ...(modelErrors ? { modelErrors } : {}), ms: 1, usd: 0 });
    const base = { status: "done" as const, sample: ["a", "b"] };
    const fine = { ...base, results: [res(32, 1), res(32, 0)] };
    const bad = { ...base, results: [res(20, 12), res(32, 0)] };
    expect(modelCalls(fine)).toEqual({ calls: 65, errors: 1 });
    expect(ranToEnd(fine)).toBe(true);
    expect(ranToEnd(bad)).toBe(false);
    expect(incompleteReason(bad as unknown as BenchRun)).toMatch(/12 of 64 model calls failed/);
  });
});

describe("the reply limit", () => {
  it("is never lowered for a benchmark: a provider that refuses it fails the call", async () => {
    const limits: number[] = [];
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async (r: ChatRequest) => {
        limits.push(r.maxTokens ?? 0);
        throw new Error("400: max_tokens is too large: 32768 > 16384");
      },
    };
    const events: ProveEvent[] = [];
    await prove({ frozen, provider, model: "m", run, check: wrong, maxAttempts: 1, revisions: 1, automation: false, repair: false, maxTokens: 32768, strictMaxTokens: true, onEvent: (e) => events.push(e) });
    expect(limits).toEqual([32768]);
    expect(events.find((e) => e.type === "attempt")).toMatchObject({ outcome: "model error" });
  });
});

describe("the test call before a run", () => {
  it("sends the run's exact settings, and says which model answered and whether thinking came back", async () => {
    const asked: ChatRequest[] = [];
    const ok: ModelProvider = { name: "fake", listModels: async () => [], chat: async (r) => (asked.push(r), { content: "5", reasoning: "2 + 3 = 5", servedModel: "z-ai/glm-5.3" }) };
    const r = await preflight(ok, "glm-5.3", { effort: "high", maxTokens: 32768, temperature: 0.6 });
    expect(asked[0]).toMatchObject({ model: "glm-5.3", maxTokens: 32768, temperature: 0.6, reasoningEffort: "high" });
    expect(r).toMatchObject({ ok: true, served: "z-ai/glm-5.3", thinking: true });

    const refuses: ModelProvider = { name: "fake", listModels: async () => [], chat: async () => Promise.reject(new Error("400: temperature is not supported with reasoning")) };
    expect(await preflight(refuses, "gpt-6.1-sol", { effort: "high", temperature: 0.6 })).toMatchObject({ ok: false, error: expect.stringContaining("temperature") });
  });
});

describe("what the provider reports", () => {
  it("reads the served model and thinking tokens, from a whole reply and from a stream", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ model: "glm-5.3-0901", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 37 } } })));
    const p = new OpenAICompatibleProvider("Fake", "https://x.test/v1", "k");
    expect(await p.chat({ model: "glm-5.3", messages: [] })).toMatchObject({ servedModel: "glm-5.3-0901", reasoningTokens: 37 });

    const sse = ['data: {"model":"other-model","choices":[{"delta":{"content":"ok"}}]}', 'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":9,"completion_tokens_details":{"reasoning_tokens":0}}}', "data: [DONE]", ""].join("\n");
    vi.stubGlobal("fetch", async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    expect(await p.chat({ model: "glm-5.3", messages: [], onDelta: () => undefined })).toMatchObject({ content: "ok", servedModel: "other-model", reasoningTokens: 0 });
  });

  it("counts a router's prefix or a dated version as the model asked for, and anything else as another model", () => {
    expect(sameModel("glm-5.3", "z-ai/glm-5.3")).toBe(true);
    expect(sameModel("gpt-6.1-sol", "gpt-6.1-sol-2026-10-01")).toBe(true);
    expect(sameModel("glm-5.3", "glm-4.6")).toBe(false);
  });
});

describe("a run's page and pull request", () => {
  const log = (o: Partial<NonNullable<BenchResult["log"]>[number]>) => ({ n: 1, outcome: "errors", kind: "gaps" as const, model: "glm-5.3", ms: 1, tokens: 10, detail: "", candidate: "", ...o });
  const r: BenchRun = {
    id: "1",
    set: "minif2f-test",
    startedAt: 0,
    finishedAt: 1,
    status: "done",
    config: { model: "glm-5.3", maxAttempts: 2, parallel: 1, automation: false, revisions: 1, protocol: "passk", effort: "high", maxTokens: 32768, temperature: 0.6 },
    sample: ["p"],
    budget: 0,
    results: [{ id: "p", outcome: "failed", attempts: 1, modelErrors: 1, ms: 1, usd: 0, log: [log({}), log({ n: 2, outcome: "model error", kind: "model", servedModel: undefined, tokens: 0 })] }],
  };

  it("say when thinking never came back, how many calls failed, and the limits every model got", () => {
    expect(thinkingReturned(r)).toEqual({ replies: 1, withThinking: 0 });
    const md = runSummary(r, "Results");
    expect(md).toContain("| Reply limit | 32768 tokens |");
    expect(md).toContain("| Temperature | 0.6 |");
    expect(md).toContain("⚠️ Model calls: 1 of 2 failed");
    expect(md).toContain("⚠️ Thinking at high: none came back");
    const page = buildSite([{ ...r, folder: "f" }], "https://github.com/o/r")["runs/f.html"];
    expect(page).toContain('id="fairness"');
    expect(page).toContain("the model may ignore the level");
  });

  it("list another model the provider served", () => {
    const served = { ...r, results: [{ ...r.results[0], log: [log({ thinking: "…", servedModel: "glm-4.6" })] }] };
    expect(servedOthers(served)).toEqual([{ model: "glm-4.6", count: 1 }]);
    expect(runSummary(served, "Results")).toContain("⚠️ Served model: glm-4.6 on 1");
  });
});
