// Runs Lean on a source file inside a Mathlib workspace (`lake env lean`),
// bounded by a deadline. Only an exit Lean chose is its verdict: a timeout,
// a spawn failure or a kill is "no verdict", never a pass.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTree, lakeCommand, leanEnv } from "./toolchain";
import { freshRunScript, LINTERS_OFF, remoteLean, sshArgs, type RemoteLean } from "./remote";
import type { LeanRun, RunResult } from "./verify";

/**
 * One Lean process with Mathlib loaded takes about 5 to 6 GB, and every feature
 * (proof runs, searches, swarms, the chat) starts them; without a bound they
 * add up until the computer can run nothing else. All of Mack's fresh Lean runs
 * share these slots, and wait their turn when none is free.
 */
let slots = 2;
let busy = 0;
const waiting: (() => void)[] = [];

const pump = () => {
  while (busy < slots && waiting.length) {
    busy++;
    waiting.shift()!();
  }
};

/** How many fresh Lean runs may be alive at once (at least one). */
export function setLeanSlots(n: number): void {
  slots = Math.max(1, Math.floor(n) || 1);
  pump();
}

/** Fresh Lean runs running and waiting, for display and tests. */
export function leanSlots(): { slots: number; busy: number; waiting: number } {
  return { slots, busy, waiting: waiting.length };
}

/** Run `fn` holding one of the slots; when `signal` aborts while it waits, it leaves the queue and `fn` never runs. */
export async function withLeanSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("stopped"));
    const turn = () => {
      signal?.removeEventListener("abort", leave);
      resolve();
    };
    const leave = () => {
      const i = waiting.indexOf(turn);
      if (i >= 0) waiting.splice(i, 1);
      reject(new Error("stopped"));
    };
    signal?.addEventListener("abort", leave, { once: true });
    waiting.push(turn);
    pump();
  });
  try {
    return await fn();
  } finally {
    busy--;
    pump();
  }
}

/** Fresh Lean runs and REPLs together, from the person's limit (0: this computer's memory decides). */
export function leanBudget(limit: number, totalBytes: number): number {
  if (limit > 0) return Math.floor(limit);
  // Half the memory, at about 6 GB a process: 16 GB → 1, 32 GB → 2, 64 GB → 5.
  return Math.max(1, Math.min(6, Math.floor((totalBytes * 0.5) / (6 * 1024 ** 3))));
}

/** How a budget splits: REPLs (resident, for quick checks; 0 means none) and slots for fresh runs (verification). */
export function splitBudget(budget: number, wantedRepls: number): { repls: number; fresh: number } {
  if (budget < 2) return { repls: 0, fresh: 1 };
  const repls = Math.max(1, Math.min(wantedRepls, budget - 1));
  return { repls, fresh: budget - repls };
}

export type LeanConfig = {
  /** A Lake project with Mathlib as a dependency (see core/lean/setup.ts). */
  workspace: string;
  timeoutMs: number;
  /** Stops every run of this runner: a waiting one never starts, a running Lean is killed. Either is "no verdict". */
  signal?: AbortSignal;
};

const STOPPED: RunResult = { kind: "noVerdict", reason: "stopped" };

export function leanRunner(config: LeanConfig): LeanRun {
  return (source: string): Promise<RunResult> => (config.signal?.aborted ? Promise.resolve(STOPPED) : withLeanSlot(() => runOnce(config, source), config.signal).catch(() => STOPPED));
}

/** One run on the remote machine: the source goes over stdin, and only Lean's own exit is a verdict. */
function runRemote(r: RemoteLean, config: LeanConfig, source: string): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    let output = "";
    let settled = false;
    const done = (x: RunResult) => {
      if (!settled) {
        settled = true;
        resolve(x);
      }
    };
    const child = spawn("ssh", sshArgs(r, freshRunScript(config.timeoutMs / 1000)), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    // The remote `timeout` ends Lean; this one ends a connection that hangs, with a margin for the network.
    const timer = setTimeout(() => {
      killTree(child);
      done({ kind: "noVerdict", reason: `the remote Lean run on ${r.host} exceeded the ${config.timeoutMs} ms deadline` });
    }, config.timeoutMs + 30_000);
    child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ kind: "noVerdict", reason: `could not start ssh: ${e.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) done({ kind: "ok", output });
      // 124 is `timeout` ending Lean; 255 is ssh failing to connect: neither is Lean's verdict.
      else if (code === 124) done({ kind: "noVerdict", reason: `lean exceeded the ${config.timeoutMs} ms deadline on ${r.host}` });
      else if (code === 255) done({ kind: "noVerdict", reason: `ssh could not reach ${r.host}:\n${output}` });
      else if (code !== null) done({ kind: "refused", output: `lean exited with ${code}:\n${output}` });
      else done({ kind: "noVerdict", reason: `the remote run was ended by ${signal}:\n${output}` });
    });
    const stop = () => {
      killTree(child);
      done(STOPPED);
    };
    config.signal?.addEventListener("abort", stop, { once: true });
    child.on("close", () => config.signal?.removeEventListener("abort", stop));
    child.stdin.end(source);
  });
}

async function runOnce(config: LeanConfig, source: string): Promise<RunResult> {
  const r = remoteLean();
  if (r) return runRemote(r, config, source);
  const dir = await mkdtemp(join(tmpdir(), "mack-lean-"));
  const file = join(dir, "Probe.lean");
  try {
    await writeFile(file, source, "utf8");
    return await new Promise<RunResult>((resolve) => {
      let output = "";
      let settled = false;
      const done = (r: RunResult) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      const child = spawn(lakeCommand(), ["env", "lean", LINTERS_OFF, file], {
        cwd: config.workspace,
        env: leanEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
      const timer = setTimeout(() => {
        killTree(child);
        done({ kind: "noVerdict", reason: `lean exceeded the ${config.timeoutMs} ms deadline` });
      }, config.timeoutMs);
      const stop = () => {
        clearTimeout(timer);
        killTree(child);
        done(STOPPED);
      };
      config.signal?.addEventListener("abort", stop, { once: true });
      child.on("close", () => config.signal?.removeEventListener("abort", stop));
      child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
      child.on("error", (e) => {
        clearTimeout(timer);
        done({ kind: "noVerdict", reason: `could not start lake: ${e.message}` });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) done({ kind: "ok", output });
        else if (code !== null) done({ kind: "refused", output: `lean exited with ${code}:\n${output}` });
        else done({ kind: "noVerdict", reason: `lean was ended by ${signal}:\n${output}` });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
