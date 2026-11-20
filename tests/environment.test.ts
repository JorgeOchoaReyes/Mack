import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeEnvironment, probeEnvironment } from "../core/environment";

describe("telling the agent what this computer has", () => {
  it("names the shell, Lean with Mathlib's commit and source, and Python's libraries", () => {
    const text = describeEnvironment({
      platform: "win32",
      lean: { workspace: "C:\\Users\\me\\mack-lean", toolchain: "leanprover/lean4:v4.33.1", mathlib: "abcdef1234567890", mathlibSource: "C:\\m\\Mathlib" },
      python: { exe: "python", version: "3.12.4", libs: { numpy: true, sympy: true, networkx: false } },
    });
    expect(text).toContain("PowerShell");
    expect(text).toContain("Lean (v4.33.1) with Mathlib at commit abcdef1234");
    expect(text).toContain("search_mathlib");
    expect(text).toContain("Python 3.12.4 as `python`, with numpy, sympy.");
    expect(text).toContain("Not installed: networkx; install one with `python -m pip install --user <name>`");
  });

  it("says plainly what is missing", () => {
    const text = describeEnvironment({ platform: "darwin" });
    expect(text).toContain("macOS");
    expect(text).toContain("Lean and Mathlib are not installed yet");
    expect(text).toContain("No Python");
  });

  it("finds a workspace's toolchain and Mathlib commit, and this computer's Python", async () => {
    const ws = mkdtempSync(join(tmpdir(), "mack-env-"));
    writeFileSync(join(ws, "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
    writeFileSync(join(ws, "lake-manifest.json"), JSON.stringify({ packages: [{ name: "mathlib", rev: "0123456789abcdef" }] }));
    mkdirSync(join(ws, ".lake", "packages", "mathlib", "Mathlib"), { recursive: true });
    const env = await probeEnvironment(ws);
    expect(env.lean).toMatchObject({ toolchain: "leanprover/lean4:v4.33.1", mathlib: "0123456789abcdef" });
    expect(env.lean?.mathlibSource).toContain("Mathlib");
    if (env.python) expect(typeof env.python.libs.numpy).toBe("boolean");
  }, 30_000);
});
