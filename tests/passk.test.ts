import { describe, expect, it } from "vitest";
import type { LeanCheck } from "../core/lean/check";
import type { RunResult } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import { prove, type ProveEvent } from "../core/prove";
import { BENCH_SETS, harnessOf, pickSample, protocolLabel, runBench, type BenchRun } from "../core/bench/bench";

const frozen = "import Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  sorry\n";
const run = async (src: string): Promise<RunResult> => {
  const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
  const thm = /#print axioms (\S+)/.exec(src)?.[1];
  return marker && thm ? { kind: "ok", output: `${marker}\n'${thm}' depends on axioms: [propext]\n${thm} : P\n` } : { kind: "ok", output: "" };
};
// Lean rejects the misspelled name; the right one passes.
const check = async (src: string): Promise<LeanCheck> =>
  src.includes("Nat.addZero") ? { status: "errors", errors: [{ line: 4, col: 8, message: "Unknown identifier `Nat.addZero`" }], sorries: [], output: "" } : { status: "complete", errors: [], sorries: [], output: "" };

describe("pass@k, the labs' protocol", () => {
  it("samples each attempt from the opening prompt alone, and checks it exactly as the model wrote it", async () => {
    const asked: ChatRequest[] = [];
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async (r: ChatRequest) => {
        asked.push({ ...r, messages: [...r.messages] });
        return { content: "```lean\nimport Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  exact Nat.addZero x\n```" };
      },
    };
    const events: ProveEvent[] = [];
    // As a pass@k run sets it: a fresh conversation every attempt, no automation, no repairs.
    await prove({ frozen, provider, model: "m", run, check, maxAttempts: 3, revisions: 1, automation: false, repair: false, rename: async (names) => Object.fromEntries(names.map((n) => [n, "Nat.add_zero"])), onEvent: (e) => events.push(e) });
    expect(asked).toHaveLength(3);
    // Every sample saw only the opening prompt: no Lean feedback from the one before.
    expect(asked.map((r) => r.messages.length)).toEqual([2, 2, 2]);
    expect(JSON.stringify(asked[2].messages)).not.toContain("Unknown identifier");
    // The name was not repaired, so nothing was solved, and the prompt did not invite sorry.
    expect(events.some((e) => e.type === "solved")).toBe(false);
    expect(asked[0].messages[0].content).toContain("a `sorry` fails the attempt");
    expect(asked[0].messages[0].content).not.toContain("may be left as `sorry`");
  });

  it("gives a reasoning model room to think, and asks again with the usual limit when the provider allows less", async () => {
    const limits: number[] = [];
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async (r: ChatRequest) => {
        limits.push(r.maxTokens ?? 0);
        if ((r.maxTokens ?? 0) > 16000) throw new Error("400: max_tokens is too large: 32768 > 16384");
        return { content: "```lean\nimport Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  exact Nat.add_zero x\n```" };
      },
    };
    const events: ProveEvent[] = [];
    await prove({ frozen, provider, model: "m", run, check, maxAttempts: 1, revisions: 1, automation: false, repair: false, maxTokens: 32768, onEvent: (e) => events.push(e) });
    expect(limits).toEqual([32768, 8192]);
    expect(events.some((e) => e.type === "solved")).toBe(true);
  });

  it("names its harness and its label by k", () => {
    const config = { model: "m", maxAttempts: 32, parallel: 1, automation: false, revisions: 1, protocol: "passk" as const };
    expect(harnessOf(config, "0.2.42", "687f2a20").procedures).toEqual(["strict verifier", "linters off", "pass@32: independent samples, checked as written", "replies up to 32k tokens"]);
    expect(protocolLabel({ config })).toBe("pass@32");
    expect(protocolLabel({ config: { ...config, protocol: undefined } })).toBe("Mack agent");
  });

  it("runs problems at once and keeps the results in the sample's order", async () => {
    const set = BENCH_SETS[0];
    const sample = pickSample(set, 6);
    const bench: BenchRun = { id: "c", set: set.id, startedAt: 0, finishedAt: 0, status: "running", config: { model: "m", maxAttempts: 1, parallel: 1, automation: false, revisions: 1 }, sample, results: [], budget: 0 };
    let running = 0;
    let most = 0;
    const done = await runBench({
      run: bench,
      set,
      signal: new AbortController().signal,
      concurrency: 3,
      onEvent: () => {},
      // Later problems finish first, so completion order differs from the sample's.
      proveOne: async (p) => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 30 - sample.indexOf(p.id) * 4));
        running--;
        return { id: p.id, outcome: "failed", attempts: 1, ms: 1, usd: 0 };
      },
    });
    expect(most).toBe(3);
    expect(done.results.map((r) => r.id)).toEqual(sample);
    expect(done.status).toBe("done");
  });
});

import { attemptKind, benchSlug as slugOfRun, FAILURES as REASONS } from "../core/bench/bench";

describe("a pass@k run's names and labels", () => {
  it("labels a reply cut off before the theorem as cut off, not as a changed statement", () => {
    expect(attemptKind({ outcome: "refused", detail: "the frozen theorem statement must appear verbatim", truncated: true })).toBe("cutoff");
    expect(attemptKind({ outcome: "refused", detail: "the frozen theorem statement must appear verbatim" })).toBe("statement");
    expect(REASONS.cutoff.label).toMatch(/cut off/i);
  });

  it("names a pass@k run's folder after its protocol", () => {
    const run = { set: "minif2f-test", startedAt: Date.UTC(2026, 10, 27, 21, 18), config: { protocol: "passk", maxAttempts: 32, model: "m" } } as never;
    expect(slugOfRun(run)).toBe("minif2f-test-pass32-202611272118");
  });
});
