import { describe, expect, it } from "vitest";
import { callCost, metered, SpendCapReached, type Meter } from "../core/model/metered";
import type { ModelProvider } from "../core/model/provider";
import { runTurn, type ChatSession } from "../core/chat/agent";

const provider = (usage = true): ModelProvider & { calls: number } => {
  const p = {
    name: "fake",
    calls: 0,
    listModels: async () => [],
    chat: async () => {
      p.calls++;
      return { content: "x".repeat(400), ...(usage ? { usage: { promptTokens: 1_000_000, completionTokens: 500_000 } } : {}) };
    },
  };
  return p;
};

describe("spending cap", () => {
  it("prices calls from reported usage and refuses calls once the cap is reached", async () => {
    const meter: Meter = { spent: 0, limit: 2, estimated: false };
    const inner = provider();
    let capped = 0;
    const p = metered(inner, { input: 1, output: 2 }, meter, { onCap: () => capped++ });
    await p.chat({ model: "m", messages: [] });
    expect(meter.spent).toBe(2); // 1M × $1 + 0.5M × $2
    await expect(p.chat({ model: "m", messages: [] })).rejects.toBeInstanceOf(SpendCapReached);
    expect(inner.calls).toBe(1);
    expect(capped).toBe(1);
  });

  it("estimates tokens when the provider reports none, and says so", async () => {
    const meter: Meter = { spent: 0, limit: 0, estimated: false };
    await metered(provider(false), { input: 1_000_000, output: 1_000_000 }, meter).chat({ model: "m", messages: [{ role: "user", content: "y".repeat(40) }] });
    expect(meter.estimated).toBe(true);
    expect(meter.spent).toBe(10 + 100); // 40/4 prompt + 400/4 completion tokens at $1 each
    expect(callCost({ input: 3, output: 15 }, 1000, 2000)).toBeCloseTo(0.033);
  });

  it("stops a chat turn when its session's cap is reached", async () => {
    const meter: Meter = { spent: 0, limit: 0.5, estimated: false };
    const inner: ModelProvider = { name: "f", listModels: async () => [], chat: async () => ({ content: '```tool\n{"name": "list_files", "args": {}}\n```', usage: { promptTokens: 1_000_000, completionTokens: 0 } }) };
    const session: ChatSession = { id: "s", projectId: "p", title: "", startedAt: 0, updatedAt: 0, messages: [{ role: "user", content: "go", at: 0 }] };
    const events: string[] = [];
    await runTurn(session, {
      provider: metered(inner, { input: 1, output: 0 }, meter),
      model: "m",
      projectName: "P",
      memory: "",
      execute: async (c) => ({ ...c, ok: true, output: "a", protected: false }),
      onEvent: (e) => e.type === "error" && events.push(e.message),
    });
    expect(events[0]).toContain("spending cap");
    expect(meter.spent).toBe(1);
  });
});

describe("assumed price", () => {
  it("counts an unpriced model at the high assumed price, and a priced one at its own", async () => {
    const { priceFor, ASSUMED_PRICE } = await import("../core/model/metered");
    expect(priceFor({}, "m")).toEqual({ price: ASSUMED_PRICE, assumed: true });
    expect(priceFor({ m: { input: 0.2, output: 0.6 } }, "m")).toEqual({ price: { input: 0.2, output: 0.6 }, assumed: false });
    const meter: Meter = { spent: 0, limit: 1, estimated: false };
    const p = metered(provider(), priceFor({}, "m").price, meter);
    await p.chat({ model: "m", messages: [] });
    // 1M input × $10 + 0.5M output × $30: far past a $1 limit, so the next call is refused.
    expect(meter.spent).toBe(25);
    await expect(p.chat({ model: "m", messages: [] })).rejects.toBeInstanceOf(SpendCapReached);
  });
});
