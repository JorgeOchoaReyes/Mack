// What this computer offers the chat's agent, found by looking rather than
// assumed: Open Math Harness tells its agents exactly what their machine has
// (the Lean toolchain, where Mathlib's source is, which Python libraries), so
// they neither guess at tools that are not there nor overlook ones that are.
// Mack runs on the person's own computer, so it checks.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mathlibSource } from "./lean/mathlib-index";
import { findPython } from "./construct/search";

/** Python libraries a mathematician's computation is likely to reach for. */
export const MATH_LIBS = ["numpy", "sympy", "scipy", "mpmath", "networkx", "matplotlib", "pandas"];

export type Environment = {
  platform: NodeJS.Platform;
  lean?: { toolchain?: string; mathlib?: string; mathlibSource?: string; workspace: string };
  python?: { exe: string; version: string; libs: Record<string, boolean> };
};

function run(exe: string, args: string[], timeoutMs = 15_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return resolve({ code: null, out: "" });
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => (clearTimeout(timer), resolve({ code: null, out })));
    child.on("close", (code) => (clearTimeout(timer), resolve({ code, out })));
  });
}

/** Look at the Lean workspace and Python on this computer. */
export async function probeEnvironment(workspace: string): Promise<Environment> {
  const env: Environment = { platform: process.platform };
  if (existsSync(join(workspace, "lake-manifest.json")) || existsSync(join(workspace, "lean-toolchain"))) {
    let toolchain: string | undefined;
    let mathlib: string | undefined;
    try {
      toolchain = readFileSync(join(workspace, "lean-toolchain"), "utf8").trim();
    } catch {
      // No toolchain file: the version is not named.
    }
    try {
      const m = JSON.parse(readFileSync(join(workspace, "lake-manifest.json"), "utf8")) as { packages?: { name?: string; rev?: string }[] };
      mathlib = m.packages?.find((p) => p.name === "mathlib")?.rev;
    } catch {
      // No manifest: Mathlib's commit is not named.
    }
    const src = mathlibSource(workspace);
    env.lean = { workspace, toolchain, mathlib, ...(src ? { mathlibSource: join(src, "Mathlib") } : {}) };
  }
  const exe = await findPython();
  if (exe) {
    const version = (await run(exe, ["--version"])).out.trim().replace(/^Python\s*/, "");
    const probe = `import importlib.util, json; print(json.dumps({m: importlib.util.find_spec(m) is not None for m in ${JSON.stringify(MATH_LIBS)}}))`;
    let libs: Record<string, boolean> = {};
    try {
      libs = JSON.parse((await run(exe, ["-c", probe])).out.trim().split("\n").pop() ?? "{}") as Record<string, boolean>;
    } catch {
      // The probe printed nothing readable: the libraries are not named.
    }
    env.python = { exe, version, libs };
  }
  return env;
}

/** The environment as the agent reads it. */
export function describeEnvironment(e: Environment): string {
  const os = e.platform === "win32" ? "Windows" : e.platform === "darwin" ? "macOS" : "Linux";
  const lines = [`- ${os}; \`shell_exec\` runs ${e.platform === "win32" ? "PowerShell" : "a POSIX shell"} in the project folder.`];
  if (e.lean) {
    lines.push(
      `- Lean ${e.lean.toolchain ? `(${e.lean.toolchain.replace(/^leanprover\/lean4:/, "")}) ` : ""}with Mathlib${e.lean.mathlib ? ` at commit ${e.lean.mathlib.slice(0, 10)}` : ""}, in the workspace ${e.lean.workspace}. Lean checks go through \`check_lean\`; the first one after Mack starts loads Mathlib and can take a minute or more, later ones a few seconds.`,
    );
    if (e.lean.mathlibSource) lines.push(`- Mathlib's source is at ${e.lean.mathlibSource}. Find real names with \`search_mathlib\` rather than guessing them; a name or type it shows is confirmed with \`#check\`.`);
  } else lines.push("- Lean and Mathlib are not installed yet (Setup installs them), so Lean tools will fail until they are.");
  if (e.python) {
    const have = Object.entries(e.python.libs).filter(([, v]) => v).map(([k]) => k);
    const missing = Object.entries(e.python.libs).filter(([, v]) => !v).map(([k]) => k);
    lines.push(
      `- Python ${e.python.version} as \`${e.python.exe}\`${have.length ? `, with ${have.join(", ")}` : ", with none of the usual math libraries"}.${missing.length ? ` Not installed: ${missing.join(", ")}; install one with \`${e.python.exe} -m pip install --user <name>\` through \`shell_exec\` if a step needs it.` : ""} Construction searches run with this Python.`,
    );
  } else lines.push("- No Python on this computer's PATH: computations and construction searches are unavailable until the person installs it (python.org).");
  return `# This computer\n\nWhat Mack found installed here; plan with it instead of guessing:\n${lines.join("\n")}`;
}
