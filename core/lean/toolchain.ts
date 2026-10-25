// Where Lean's tools live. elan installs into %USERPROFILE%\.elan\bin and
// adds it to PATH only for shells started afterwards, so Mack looks there
// first and passes that directory on to every Lean process it starts.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const ELAN_BIN = join(homedir(), ".elan", "bin");

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** The `lake` to run: elan's own when installed, else whatever PATH has. */
export function lakeCommand(): string {
  const local = join(ELAN_BIN, exe("lake"));
  return existsSync(local) ? local : "lake";
}

/** The environment for Lean processes: elan's bin first on PATH. */
export function leanEnv(): NodeJS.ProcessEnv {
  const path = process.env.PATH ?? process.env.Path ?? "";
  const env = { ...process.env };
  delete env.Path;
  env.PATH = `${ELAN_BIN}${delimiter}${path}`;
  return env;
}

export type ProcessResult = { code: number | null; output: string };

/** Run a command to completion, streaming each output line to `onLine`. */
export function runStreaming(
  command: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string) => void; signal?: AbortSignal },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let output = "";
    let partial = "";
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: leanEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      signal: opts.signal,
    });
    const onData = (d: Buffer) => {
      const text = d.toString("utf8");
      output += text;
      const lines = (partial + text).split(/\r?\n|\r/);
      partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) opts.onLine?.(l);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => resolve({ code: null, output: `${output}\n${e.message}` }));
    child.on("close", (code) => {
      if (partial.trim()) opts.onLine?.(partial);
      resolve({ code, output });
    });
  });
}

/** Whether elan, the Lean toolchain manager, is installed. */
export async function hasElan(): Promise<boolean> {
  if (existsSync(join(ELAN_BIN, exe("elan")))) return true;
  return (await runStreaming("elan", ["--version"], {})).code === 0;
}

/**
 * `lake --version` as run in `workspace`, or null when Lean is not usable
 * there. elan picks the toolchain from the workspace's `lean-toolchain`
 * (setup installs elan with no default toolchain), so outside a project
 * this fails even when Lean is installed.
 */
export async function lakeVersion(workspace?: string): Promise<string | null> {
  const cwd = workspace && existsSync(workspace) ? workspace : undefined;
  const r = await runStreaming(lakeCommand(), ["--version"], { cwd });
  return r.code === 0 ? r.output.trim().split("\n")[0] : null;
}
