import { describe, expect, it } from "vitest";
import { leanBudget, leanRunner, leanSlots, setLeanSlots, splitBudget, withLeanSlot } from "../core/lean/runner";

const GB = 1024 ** 3;

describe("limiting how many Lean processes run at once", () => {
  it("runs no more than the slots allow, and the rest in the order they asked", async () => {
    setLeanSlots(2);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const release: (() => void)[] = [];
    const jobs = [0, 1, 2, 3].map((i) =>
      withLeanSlot(async () => {
        running++;
        most = Math.max(most, running);
        order.push(i);
        await new Promise<void>((r) => release.push(r));
        running--;
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([0, 1]);
    expect(leanSlots()).toEqual({ slots: 2, busy: 2, waiting: 2 });
    while (release.length < 4) {
      release.forEach((r) => r());
      await new Promise((r) => setTimeout(r, 0));
    }
    release.forEach((r) => r());
    await Promise.all(jobs);
    expect(most).toBe(2);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(leanSlots().busy).toBe(0);
  });

  it("lets a stopped run leave the queue without ever running, and starts no Lean once stopped", async () => {
    setLeanSlots(1);
    let release = () => {};
    const holder = withLeanSlot(() => new Promise<void>((r) => (release = r)));
    const ctl = new AbortController();
    let ran = false;
    const queued = withLeanSlot(async () => {
      ran = true;
    }, ctl.signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(leanSlots().waiting).toBe(1);
    ctl.abort();
    await expect(queued).rejects.toThrow("stopped");
    expect(leanSlots().waiting).toBe(0);
    release();
    await holder;
    expect(ran).toBe(false);
    // A runner whose signal is already aborted answers "no verdict" without starting Lean.
    expect(await leanRunner({ workspace: "/nowhere", timeoutMs: 1000, signal: ctl.signal })("theorem t : True := trivial")).toEqual({ kind: "noVerdict", reason: "stopped" });
  });

  it("frees a slot when a run throws", async () => {
    setLeanSlots(1);
    await expect(withLeanSlot(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withLeanSlot(async () => 7)).toBe(7);
  });

  it("picks about half the memory automatically, at 6 GB a process, and keeps a set limit", () => {
    expect(leanBudget(0, 16 * GB)).toBe(1);
    expect(leanBudget(0, 32 * GB)).toBe(2);
    expect(leanBudget(0, 64 * GB)).toBe(5);
    expect(leanBudget(0, 256 * GB)).toBe(6);
    expect(leanBudget(0, 4 * GB)).toBe(1);
    expect(leanBudget(3, 16 * GB)).toBe(3);
  });

  it("shares the budget between resident REPLs and fresh runs, always leaving a fresh one", () => {
    expect(splitBudget(1, 4)).toEqual({ repls: 0, fresh: 1 });
    expect(splitBudget(2, 4)).toEqual({ repls: 1, fresh: 1 });
    expect(splitBudget(5, 2)).toEqual({ repls: 2, fresh: 3 });
  });
});
