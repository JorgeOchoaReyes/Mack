// The setup steps and their events, shared by the setup (main process) and
// the Setup screen (renderer), so this file imports nothing from Node.

export type SetupStep = "elan" | "project" | "cache" | "verify" | "repl";

export const SETUP_STEPS: { id: SetupStep; title: string; detail: string }[] = [
  { id: "elan", title: "Lean toolchain", detail: "elan, the official Lean version manager" },
  { id: "project", title: "Mathlib project", detail: "a Lake workspace that depends on Mathlib" },
  { id: "cache", title: "Mathlib cache", detail: "prebuilt Mathlib, about 5 GB, so nothing compiles" },
  { id: "verify", title: "Check", detail: "Lean elaborates `import Mathlib`" },
  { id: "repl", title: "Lean REPL", detail: "a resident Lean for fast checks of partial proofs (optional)" },
];

export type SetupEvent =
  | { type: "step"; step: SetupStep; state: "running" | "done" | "skipped" | "failed"; message?: string }
  | { type: "log"; line: string };
