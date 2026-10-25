// Runs the chat's tool calls for one project. Protected calls go through the
// approvals guard first, adapted from open-math-harness `interfaces/approvals`
// (Apache-2.0): the guard records the exact call, the person decides, and
// on approval the guard itself runs the call it recorded, so nothing can
// change between what was approved and what runs. Approvals are single-use.

import { readFile } from "node:fs/promises";
import { checkFromRun, describeCheck, type LeanCheckRun } from "../lean/check";
import { describeRejection, pristineType, verifyText, type LeanRun } from "../lean/verify";
import type { ToolOutcome } from "./agent";
import { confine, listFiles, readProjectFile, searchFiles, TOOL_SPECS, truncate, writeProjectFile, type ToolCall } from "./tools";
import { fetchUrl, webSearch } from "./web";

export type ApprovalPolicy = "ask" | "allow";

export type ExecutorContext = {
  root: string;
  /** Lean, when installed: a fresh run for verification and the quick check. */
  lean?: { run: LeanRun; check?: LeanCheckRun };
  policy: Partial<Record<string, ApprovalPolicy>>;
  /** Ask the person about one exact call; resolves true when approved. */
  ask: (call: ToolCall) => Promise<boolean>;
  /** Start a proof run on a frozen file; resolves with a description of its outcome. */
  startProof?: (problem: string, mode: "single" | "search") => Promise<string>;
  signal?: AbortSignal;
};

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`\`${name}\` must be a non-empty string`);
  return v;
};
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

async function run(call: ToolCall, c: ExecutorContext): Promise<string> {
  const a = call.args;
  switch (call.name) {
    case "list_files":
      return listFiles(c.root, typeof a.path === "string" && a.path ? a.path : ".");
    case "read_file":
      return truncate(await readProjectFile(c.root, str(a.path, "path"), num(a.offset), num(a.limit)));
    case "search_files":
      return searchFiles(c.root, str(a.pattern, "pattern"), typeof a.path === "string" && a.path ? a.path : ".");
    case "write_file":
      if (typeof a.content !== "string") throw new Error("`content` must be a string");
      return writeProjectFile(c.root, str(a.path, "path"), a.content);
    case "check_lean": {
      if (!c.lean) throw new Error("Lean is not installed; set it up in Setup");
      const source = typeof a.source === "string" && a.source ? a.source : await readFile(await confine(c.root, str(a.path, "path or source")), "utf8");
      const check = c.lean.check ? await c.lean.check(source) : checkFromRun(await c.lean.run(source));
      return describeCheck(check);
    }
    case "verify_lean": {
      if (!c.lean) throw new Error("Lean is not installed; set it up in Setup");
      const frozen = await readFile(await confine(c.root, str(a.statement_path, "statement_path")), "utf8");
      const candidate = await readFile(await confine(c.root, str(a.proof_path, "proof_path")), "utf8");
      const pristine = await pristineType(frozen, c.lean.run);
      if (!pristine.ok) return `The statement file is not usable: ${pristine.reason}`;
      const v = await verifyText(frozen, pristine.type, candidate, c.lean.run);
      return v.ok ? `accepted: the strict verifier accepts the proof (axioms: ${v.axioms.join(", ") || "none"})` : `rejected: ${describeRejection(v.rejection)}`;
    }
    case "web_search":
      return webSearch(str(a.query, "query"), c.signal);
    case "fetch_url":
      return fetchUrl(str(a.url, "url"), c.signal);
    case "start_proof": {
      if (!c.startProof) throw new Error("proof runs are not available here");
      const problem = await readFile(await confine(c.root, str(a.path, "path")), "utf8");
      return c.startProof(problem, a.mode === "single" ? "single" : "search");
    }
    default:
      throw new Error(`unknown tool \`${call.name}\``);
  }
}

/** Run one call, through the guard when it is protected. Never throws: a failure is an outcome. */
export async function execute(call: ToolCall, c: ExecutorContext): Promise<ToolOutcome> {
  const spec = TOOL_SPECS.find((t) => t.name === call.name);
  const prot = !!spec?.protected;
  // The guard records the call: what runs is this copy, whatever happens to the original.
  const recorded: ToolCall = { name: call.name, args: JSON.parse(JSON.stringify(call.args)) as Record<string, unknown> };
  let decision: ToolOutcome["decision"];
  if (prot) {
    if ((c.policy[call.name] ?? "ask") === "allow") decision = "auto";
    else {
      decision = (await c.ask(recorded)) ? "approved" : "denied";
      if (decision === "denied") return { ...recorded, ok: false, output: "The person denied this call.", protected: true, decision };
    }
  }
  try {
    return { ...recorded, ok: true, output: await run(recorded, c), protected: prot, decision };
  } catch (e) {
    return { ...recorded, ok: false, output: (e as Error).message, protected: prot, decision };
  }
}
