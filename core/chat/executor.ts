// Runs the chat's tool calls for one project. Protected calls go through the
// approvals guard first, adapted from open-math-harness `interfaces/approvals`
// (Apache-2.0): the guard records the exact call, the person decides, and
// on approval the guard itself runs the call it recorded, so nothing can
// change between what was approved and what runs. Approvals are single-use.

import { readFile, rm, rmdir, stat } from "node:fs/promises";
import { describeResult, runCommand, type JobManager } from "./shell";
import { loadSkill } from "./skills";
import { checkFromRun, describeCheck, type LeanCheckRun } from "../lean/check";
import { describeRejection, pristineType, verifyText, type LeanRun } from "../lean/verify";
import type { ToolOutcome } from "./agent";
import type { McpTarget } from "../mcp/client";
import { PLUGIN_GUIDE } from "../mcp/plugins";
import { confine, imageDataUrl, listFiles, readProjectFile, searchFiles, toolSpecs, truncate, writeProjectFile, type ToolCall, type ToolSpec } from "./tools";
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
  /** What only a chat session has: its reminders, background jobs, sub-agents, and whether its model reads images. */
  session?: SessionHooks;
  /** Runs a registered extra tool (`registerTools`) or one of the session's own; undefined when the name is not one. */
  extra?: (call: ToolCall) => Promise<string> | undefined;
  /** The session's own tool specs (its plugins'), for the guard. */
  ownTools?: () => ToolSpec[];
  /** The session's plugins and MCP servers. */
  plugins?: PluginHooks;
  signal?: AbortSignal;
};

export type PluginHooks = {
  start: (kind: "mcp" | "plugin", name: string, target: McpTarget, map: string[]) => Promise<string>;
  replace: (name: string, target: McpTarget, map: string[]) => Promise<string>;
  stop: (name: string) => string;
  list: () => string;
};

export type SessionHooks = {
  id: string;
  vision: boolean;
  remind: (text: string, minutes: number) => string;
  reminders: () => string;
  cancelReminder: (id: string) => string;
  jobs: JobManager;
  subAgent: (task: string) => Promise<string>;
};

const LOCAL = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/;

async function httpRequest(a: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const u = new URL(str(a.url, "url"));
  if (u.protocol !== "https:") throw new Error("only https URLs");
  if (LOCAL.test(u.hostname)) throw new Error("local addresses are not reached");
  const method = typeof a.method === "string" ? a.method.toUpperCase() : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) throw new Error(`method ${method} is not allowed`);
  const headers: Record<string, string> = {};
  if (a.headers && typeof a.headers === "object") for (const [k, v] of Object.entries(a.headers)) if (typeof v === "string") headers[k] = v;
  const res = await fetch(u, { method, headers, body: typeof a.body === "string" && method !== "GET" && method !== "HEAD" ? a.body : undefined, signal });
  const text = await res.text();
  return `HTTP ${res.status} ${res.statusText}\ncontent-type: ${res.headers.get("content-type") ?? ""}\n\n${truncate(text)}`;
}

const needSession = (c: ExecutorContext): SessionHooks => {
  if (!c.session) throw new Error("this tool is only available in a chat");
  return c.session;
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
    case "remove_file": {
      const file = await confine(c.root, str(a.path, "path"));
      if (file === (await confine(c.root, "."))) throw new Error("the project folder itself is not removed");
      if ((await stat(file)).isDirectory()) await rmdir(file);
      else await rm(file);
      return `removed ${String(a.path)}`;
    }
    case "shell_exec": {
      const command = str(a.command, "command");
      const background = a.background === true || a.background === "true";
      const limit = background ? 3600 : 600;
      const seconds = Math.min(limit, Math.max(1, num(a.timeout_s) ?? (background ? limit : 120)));
      if (background) {
        const job = needSession(c).jobs.start(needSession(c).id, c.root, command, seconds * 1000);
        return `started background command ${job.id}; this chat is told when it ends (shell_jobs reads its output)`;
      }
      return describeResult(await runCommand(c.root, command, seconds * 1000, c.signal), seconds * 1000);
    }
    case "shell_jobs": {
      const s = needSession(c);
      const action = str(a.action, "action");
      if (action === "list") return s.jobs.list(s.id);
      if (action === "output") return truncate(s.jobs.output(s.id, str(a.id, "id")));
      if (action === "stop") return s.jobs.stop(s.id, str(a.id, "id"));
      throw new Error("action is list, output or stop");
    }
    case "http_request":
      return httpRequest(a, c.signal);
    case "view_image": {
      const s = needSession(c);
      const url = await imageDataUrl(c.root, str(a.path, "path"));
      if (!s.vision) return "Your model does not read images here; the person can turn image reading on in the chat's tools panel.";
      viewImages.set(call, [url]);
      return `the image ${String(a.path)} follows`;
    }
    case "conversation_remind": {
      const minutes = Math.min(10080, Math.max(1, num(a.in_minutes) ?? 10));
      return needSession(c).remind(str(a.text, "text").slice(0, 2000), minutes);
    }
    case "conversation_reminders":
      return needSession(c).reminders();
    case "conversation_cancel_reminder":
      return needSession(c).cancelReminder(str(a.id, "id"));
    case "run_agent":
      return needSession(c).subAgent(str(a.task, "task"));
    case "skills_load":
      return loadSkill(c.root, str(a.url, "url"), c.signal);
    case "mcp_connect":
    case "plugin_start":
    case "plugin_replace": {
      if (!c.plugins) throw new Error("plugins are only available in a chat");
      const name = str(a.name, "name");
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
      const target: McpTarget =
        call.name === "mcp_connect" && typeof a.url === "string" && a.url ? { url: a.url } : { command: str(a.command, "command or url"), args: list(a.args), cwd: c.root };
      if (call.name === "plugin_replace") return c.plugins.replace(name, target, list(a.tools));
      return c.plugins.start(call.name === "mcp_connect" ? "mcp" : "plugin", name, target, list(a.tools));
    }
    case "plugin_stop":
      if (!c.plugins) throw new Error("plugins are only available in a chat");
      return c.plugins.stop(str(a.name, "name"));
    case "plugin_list":
      if (!c.plugins) throw new Error("plugins are only available in a chat");
      return c.plugins.list();
    case "plugin-development_guide":
      return PLUGIN_GUIDE;
    default: {
      const r = c.extra?.(call);
      if (r) return r;
      throw new Error(`unknown tool \`${call.name}\``);
    }
  }
}

/** Images `view_image` read for a call, handed to its outcome. */
const viewImages = new WeakMap<ToolCall, string[]>();

/** Run one call, through the guard when it is protected. Never throws: a failure is an outcome. */
export async function execute(call: ToolCall, c: ExecutorContext): Promise<ToolOutcome> {
  const spec = toolSpecs(undefined, c.ownTools?.()).find((t) => t.name === call.name);
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
    const output = await run(recorded, c);
    const images = viewImages.get(recorded);
    return { ...recorded, ok: true, output, protected: prot, decision, ...(images ? { images } : {}) };
  } catch (e) {
    return { ...recorded, ok: false, output: (e as Error).message, protected: prot, decision };
  }
}
