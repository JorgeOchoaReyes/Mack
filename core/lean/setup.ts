// Installs Lean + Mathlib for Mack, natively on Windows: elan (the official
// toolchain manager, from its GitHub releases), a Lake project that depends
// on Mathlib, Mathlib's prebuilt cache (so nothing compiles), a check that
// `import Mathlib` works, and optionally the resident Lean REPL used for
// quick checks. Each step is skipped
// when already done, so re-running is safe and resumes after a failure.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { hasRepl, REPL_DIR } from "./repl";
import { hasElan, lakeCommand, runStreaming } from "./toolchain";

export const DEFAULT_WORKSPACE = join(homedir(), "mack-lean");

export { SETUP_STEPS, type SetupEvent, type SetupStep } from "./setup-steps";
import type { SetupEvent, SetupStep } from "./setup-steps";

const REPL_GIT = "https://github.com/leanprover-community/repl";
const ELAN_ZIP = "https://github.com/leanprover/elan/releases/latest/download/elan-x86_64-pc-windows-msvc.zip";

export function hasProject(workspace: string): boolean {
  return existsSync(join(workspace, "lakefile.toml")) || existsSync(join(workspace, "lakefile.lean"));
}

/** Whether Mathlib is built in `workspace`: its root `.olean`, which the cache download provides. */
export function hasMathlib(workspace: string): boolean {
  return existsSync(join(workspace, ".lake", "packages", "mathlib", ".lake", "build", "lib", "lean", "Mathlib.olean"));
}

async function installElan(log: (l: string) => void, signal?: AbortSignal): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "mack-elan-"));
  try {
    log(`Downloading ${ELAN_ZIP}`);
    const res = await fetch(ELAN_ZIP, { signal });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const zip = join(dir, "elan.zip");
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
    // Windows 10+ ships bsdtar, which reads zip archives. Named by its full
    // path: a GNU tar earlier on PATH (Git Bash's) reads `C:` as a remote host.
    const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const unzip = await runStreaming(tar, ["-xf", zip, "-C", dir], { onLine: log, signal });
    if (unzip.code !== 0) throw new Error("could not unpack the elan archive");
    const init = await runStreaming(join(dir, "elan-init.exe"), ["-y", "--default-toolchain", "none"], { onLine: log, signal });
    if (init.code !== 0) throw new Error(`elan-init exited with ${init.code}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runSetup(workspace: string, emit: (e: SetupEvent) => void, signal?: AbortSignal): Promise<boolean> {
  const log = (line: string) => emit({ type: "log", line });
  const step = async (id: SetupStep, skip: () => boolean | Promise<boolean>, run: () => Promise<void>) => {
    if (await skip()) {
      emit({ type: "step", step: id, state: "skipped" });
      return;
    }
    emit({ type: "step", step: id, state: "running" });
    await run();
    emit({ type: "step", step: id, state: "done" });
  };
  let current: SetupStep = "elan";
  try {
    await step(
      (current = "elan"),
      hasElan,
      () => installElan(log, signal),
    );
    await step(
      (current = "project"),
      () => hasProject(workspace),
      async () => {
        const git = await runStreaming("git", ["--version"], {});
        if (git.code !== 0) throw new Error("Git is required (Lake downloads Mathlib with it): install it from git-scm.com");
        await mkdir(dirname(workspace), { recursive: true });
        const r = await runStreaming(lakeCommand(), ["+leanprover-community/mathlib4:lean-toolchain", "new", basename(workspace), "math"], {
          cwd: dirname(workspace),
          onLine: log,
          signal,
        });
        if (r.code !== 0) throw new Error(`lake new exited with ${r.code}`);
      },
    );
    await step(
      (current = "cache"),
      () => false,
      async () => {
        const r = await runStreaming(lakeCommand(), ["exe", "cache", "get"], { cwd: workspace, onLine: log, signal });
        if (r.code !== 0) throw new Error(`lake exe cache get exited with ${r.code}`);
      },
    );
    await step(
      (current = "verify"),
      () => false,
      async () => {
        const ok = await verifyWorkspace(workspace, log, signal);
        if (!ok) throw new Error("Lean could not import Mathlib in the workspace");
      },
    );
    // Optional: without the REPL every quick check starts `lake env lean`.
    current = "repl";
    if (hasRepl(workspace)) emit({ type: "step", step: "repl", state: "skipped" });
    else {
      emit({ type: "step", step: "repl", state: "running" });
      try {
        await buildRepl(workspace, log, signal);
        emit({ type: "step", step: "repl", state: "done" });
      } catch (e) {
        emit({ type: "step", step: "repl", state: "failed", message: `${(e as Error).message}. Mack works without it, with slower checks.` });
      }
    }
    return true;
  } catch (e) {
    emit({ type: "step", step: current, state: "failed", message: (e as Error).message });
    return false;
  }
}

/**
 * Clone leanprover-community/repl at the tag matching the workspace's
 * toolchain into `<workspace>/.mack/repl` and build it. It has no
 * dependencies, so the workspace's own lakefile is left alone.
 */
export async function buildRepl(workspace: string, log: (l: string) => void, signal?: AbortSignal): Promise<void> {
  const toolchain = (await readFile(join(workspace, "lean-toolchain"), "utf8")).trim();
  const tag = toolchain.split(":").pop() ?? "";
  if (!/^v\d+\.\d+\.\d+(-rc\d+)?$/.test(tag)) throw new Error(`no REPL release matches the toolchain ${toolchain}`);
  const dir = REPL_DIR(workspace);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  log(`Cloning the Lean REPL ${tag}`);
  const clone = await runStreaming("git", ["clone", "--depth", "1", "--branch", tag, REPL_GIT, dir], { onLine: log, signal });
  if (clone.code !== 0) throw new Error(`could not clone the REPL at ${tag}`);
  const build = await runStreaming(lakeCommand(), ["build"], { cwd: dir, onLine: log, signal });
  if (build.code !== 0 || !hasRepl(workspace)) throw new Error(`lake build of the REPL exited with ${build.code}`);
}

/** Whether `lake env lean` in `workspace` elaborates `import Mathlib`. */
export async function verifyWorkspace(workspace: string, log?: (l: string) => void, signal?: AbortSignal): Promise<boolean> {
  if (!hasProject(workspace)) return false;
  const dir = await mkdtemp(join(tmpdir(), "mack-check-"));
  const file = join(dir, "MackCheck.lean");
  try {
    await writeFile(file, 'import Mathlib\n#print "mack: lean ok"\n', "utf8");
    log?.("Elaborating `import Mathlib` (the first run reads Mathlib from disk)…");
    const r = await runStreaming(lakeCommand(), ["env", "lean", file], { cwd: workspace, onLine: log, signal });
    return r.code === 0 && r.output.includes("mack: lean ok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
