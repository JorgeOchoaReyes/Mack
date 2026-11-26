import { describe, expect, it } from "vitest";
import { harnessOf } from "../core/bench/bench";
import { withEffort, type ChatRequest, type ModelProvider } from "../core/model/provider";

describe("the thinking level for proofs", () => {
  const seen: ChatRequest[] = [];
  const base: ModelProvider = { name: "fake", listModels: async () => ["m"], chat: async (r) => (seen.push(r), { content: "ok" }) };

  it("asks for it on every call that names none, and leaves a call's own level alone", async () => {
    const p = withEffort(base, "high");
    await p.chat({ model: "m", messages: [] });
    await p.chat({ model: "m", messages: [], reasoningEffort: "low" });
    expect(seen.map((r) => r.reasoningEffort)).toEqual(["high", "low"]);
    expect(await p.listModels()).toEqual(["m"]);
  });

  it("sends nothing at the model's default", () => {
    expect(withEffort(base, "default")).toBe(base);
    expect(withEffort(base, undefined)).toBe(base);
  });

  it("is part of the run's harness, so runs at different levels are not compared as equals", () => {
    const config = { model: "m", maxAttempts: 4, parallel: 1, automation: true, revisions: 0, method: "single" as const };
    expect(harnessOf({ ...config, effort: "high" }, "1", "abc").procedures).toContain("thinking high");
    expect(harnessOf(config, "1", "abc").procedures.some((p) => p.startsWith("thinking"))).toBe(false);
  });
});
