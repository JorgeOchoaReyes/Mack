// The global spending limit: one ledger of what every model call Mack makes
// has cost — chats, proof runs, search runs, Ultramath, memory, suggestions —
// against one limit, for all time (until reset), per day or per month. It is
// a `Meter`, so the same wrapper that enforces a session's cap enforces it:
// once the ledger reaches its limit, no model call starts anywhere until the
// limit is raised, the ledger is reset, or the period rolls over. A call in
// flight when the limit is crossed finishes and is charged.
//
// The ledger is a small JSON file written after every charge, so the total
// survives a restart. Days and months are the computer's local calendar.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Meter } from "./metered";

export type Period = "total" | "day" | "month";
export type LedgerState = { spent: number; limit: number; period: Period; since: number; estimated: boolean };

/** When the current period began: never for "total" (the last reset), midnight today, or the first of this month. */
export function periodStart(period: Period, now: Date, lastReset: number): number {
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return lastReset;
}

export class Ledger implements Meter {
  private data: { spent: number; since: number; estimated: boolean; lastReset: number };

  constructor(
    private readonly file: string,
    private readonly config: () => { limit: number; period: Period },
    private readonly now: () => Date = () => new Date(),
  ) {
    let saved: Partial<typeof this.data> = {};
    try {
      if (existsSync(file)) saved = JSON.parse(readFileSync(file, "utf8")) as typeof saved;
    } catch {
      // An unreadable ledger starts at zero; it is rewritten on the next charge.
    }
    const t = this.now().getTime();
    this.data = { spent: Number(saved.spent) || 0, since: Number(saved.since) || t, estimated: !!saved.estimated, lastReset: Number(saved.lastReset) || t };
  }

  /** Start a new period when the calendar has moved past the one the ledger counts. */
  private roll(): void {
    const start = periodStart(this.config().period, this.now(), this.data.lastReset);
    if (start > this.data.since) this.data = { ...this.data, spent: 0, since: start, estimated: false };
  }

  get spent(): number {
    this.roll();
    return this.data.spent;
  }

  set spent(v: number) {
    this.roll();
    this.data.spent = v;
    this.save();
  }

  get limit(): number {
    return this.config().limit;
  }

  get estimated(): boolean {
    return this.data.estimated;
  }

  set estimated(v: boolean) {
    this.data.estimated = v;
  }

  reset(): void {
    const t = this.now().getTime();
    this.data = { spent: 0, since: t, estimated: false, lastReset: t };
    this.save();
  }

  state(): LedgerState {
    this.roll();
    return { spent: this.data.spent, limit: this.limit, period: this.config().period, since: this.data.since, estimated: this.data.estimated };
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data));
  }
}
