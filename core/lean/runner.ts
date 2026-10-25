// Runs Lean on a source file inside a Mathlib workspace (`lake env lean`),
// bounded by a deadline. Only an exit Lean chose is its verdict: a timeout,
// a spawn failure or a kill is "no verdict", never a pass.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LeanRun, RunResult } from "./verify";

export type LeanConfig = {
  /** A Lake project with Mathlib as a dependency (see scripts/setup-lean.ps1). */
  workspace: string;
  timeoutMs: number;
};

export function leanRunner(config: LeanConfig): LeanRun {
  return async (source: string): Promise<RunResult> => {
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
        const child = spawn("lake", ["env", "lean", file], {
          cwd: config.workspace,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: false,
        });
        const timer = setTimeout(() => {
          child.kill();
          done({ kind: "noVerdict", reason: `lean exceeded the ${config.timeoutMs} ms deadline` });
        }, config.timeoutMs);
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
  };
}

export type CheckStatus = "invalid" | "errors" | "sorries" | "complete" | "noVerdict";

export type CheckResult = { status: CheckStatus; detail: string };

/**
 * The quick check of a partial proof: Lean's errors, or the goals left at
 * `sorry`. Not a verdict on a finished proof; that is `verifyText`.
 */
export function classifyCheck(r: RunResult): CheckResult {
  if (r.kind === "noVerdict") return { status: "noVerdict", detail: r.reason };
  const out = r.output;
  if (r.kind === "refused" || out.includes("error:")) return { status: "errors", detail: out };
  if (out.includes("declaration uses 'sorry'")) return { status: "sorries", detail: out };
  return { status: "complete", detail: out };
}
