import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ledger, periodStart, type Period } from "../core/model/ledger";
import { metered, SpendCapReached, type Meter } from "../core/model/metered";
import type { ModelProvider } from "../core/model/provider";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mack-ledger-"));
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

const fake = (): ModelProvider & { calls: number } => {
  const p = { name: "f", calls: 0, listModels: async () => [], chat: async () => (p.calls++, { content: "ok", usage: { promptTokens: 1_000_000, completionTokens: 0 } }) };
  return p;
};

describe("global spending limit", () => {
  it("adds every session's calls together and stops them all at the limit", async () => {
    const ledger = new Ledger(join(dir, "a.json"), () => ({ limit: 3, period: "total" }));
    const base = fake();
    const global = metered(base, { input: 1, output: 0 }, ledger, { scope: "global" });
    // Two sessions, each with a generous cap of its own.
    const s1: Meter = { spent: 0, limit: 100, estimated: false };
    const s2: Meter = { spent: 0, limit: 100, estimated: false };
    const why: string[] = [];
    const a = metered(global, { input: 1, output: 0 }, s1, { onCap: (w) => why.push(w) });
    const b = metered(global, { input: 1, output: 0 }, s2);
    await a.chat({ model: "m", messages: [] });
    await b.chat({ model: "m", messages: [] });
    await a.chat({ model: "m", messages: [] });
    expect(ledger.spent).toBe(3);
    await expect(b.chat({ model: "m", messages: [] })).rejects.toBeInstanceOf(SpendCapReached);
    await expect(a.chat({ model: "m", messages: [] })).rejects.toThrow("global spending limit");
    expect(why[0]).toContain("global spending limit");
    expect(base.calls).toBe(3);
  });

  it("survives a restart, resets, and starts again each period", () => {
    let now = new Date(2026, 9, 25, 23, 0);
    const file = join(dir, "b.json");
    let period: Period = "day";
    const mk = () => new Ledger(file, () => ({ limit: 5, period }), () => now);
    const l = mk();
    l.spent = 4;
    expect(mk().spent).toBe(4);
    now = new Date(2026, 9, 26, 0, 30);
    expect(mk().spent).toBe(0);
    const m = mk();
    m.spent = 2;
    period = "month";
    now = new Date(2026, 10, 1, 9, 0);
    expect(mk().spent).toBe(0);
    const t = mk();
    t.spent = 7;
    t.reset();
    expect(mk().state()).toMatchObject({ spent: 0, limit: 5 });
    expect(periodStart("total", now, 123)).toBe(123);
  });

  it("refuses calls it cannot count", async () => {
    const meter: Meter = { spent: 0, limit: 5, estimated: false };
    await expect(metered(fake(), undefined, meter).chat({ model: "m", messages: [] })).rejects.toThrow("Set the price of m");
    // Without a limit, an unpriced model runs.
    expect((await metered(fake(), undefined, { spent: 0, limit: 0, estimated: false }).chat({ model: "m", messages: [] })).content).toBe("ok");
  });
});
