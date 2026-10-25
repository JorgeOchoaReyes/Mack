// The research chat's tools (build step 4), adapted from what open-math-harness
// `program-files/chat-agent` grants an agent (fs, lean, web, pdf, and the
// approvals guard in front of protected actions), Apache-2.0.
//
// Upstream confines each agent with its capability microkernel and
// bubblewrap. Mack runs agents in-process, which is weaker: what an agent can
// do is exactly the tools below, each checking its own arguments. Every file
// path resolves inside the project folder (symbolic links included), a write
// is a protected action that waits for the person's approval, and so is
// starting a proof run, which spends model budget. Nothing else touches the
// disk, the network or a process.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ToolSpec = {
  name: string;
  description: string;
  /** Argument names with a short description; `?` marks an optional one. */
  args: Record<string, string>;
  /** Protected: runs only after the person approves this exact call. */
  protected: boolean;
};

export const TOOL_SPECS: ToolSpec[] = [
  { name: "list_files", description: "List files and folders in the project folder.", args: { "path?": "folder relative to the project, default the root" }, protected: false },
  {
    name: "read_file",
    description: "Read a text, Lean or PDF file of the project (PDFs are converted to text).",
    args: { path: "file relative to the project", "offset?": "first line, from 1", "limit?": "most lines, default 400" },
    protected: false,
  },
  { name: "search_files", description: "Search the project's text files for a regular expression.", args: { pattern: "JavaScript regular expression", "path?": "folder to search" }, protected: false },
  { name: "write_file", description: "Create or replace a file in the project. Needs the person's approval.", args: { path: "file relative to the project", content: "the whole new content" }, protected: true },
  {
    name: "check_lean",
    description: "Check Lean source with Lean and Mathlib: errors, and the goal left at each sorry. A check is not a verification.",
    args: { "source?": "Lean source", "path?": "or a .lean file of the project" },
    protected: false,
  },
  {
    name: "verify_lean",
    description: "Strictly verify a proof against a frozen statement, as the prover's verifier does.",
    args: { statement_path: "the frozen .lean file (theorem proved by sorry)", proof_path: "the candidate .lean file" },
    protected: false,
  },
  { name: "web_search", description: "Search the web; returns titles, links and snippets.", args: { query: "search terms" }, protected: false },
  { name: "fetch_url", description: "Fetch a web page or PDF over https and return its text.", args: { url: "https URL" }, protected: false },
  {
    name: "start_proof",
    description: "Start a proof run on a frozen .lean file of the project with the prover (spends model budget). Needs the person's approval. Returns the outcome and the proof if found.",
    args: { path: "the frozen .lean file", "mode?": "single or search (default search)" },
    protected: true,
  },
  { name: "remove_file", description: "Delete a file or an empty folder of the project. Needs the person's approval.", args: { path: "file relative to the project" }, protected: true },
  {
    name: "shell_exec",
    description:
      "Run a PowerShell command in the project folder (Lean's `lake` is on PATH). Needs the person's approval. With background true it keeps running after this call answers, and this chat is told when it ends.",
    args: { command: "the PowerShell command", "timeout_s?": "seconds before it is stopped, default 120, at most 600 (background: 3600)", "background?": "true to run in the background" },
    protected: true,
  },
  { name: "shell_jobs", description: "The background commands of this chat: list them, read one's output, or stop one.", args: { action: "list, output or stop", "id?": "the job, for output and stop" }, protected: false },
  {
    name: "http_request",
    description: "Make an HTTPS request with any method, headers and body (an API call). Needs the person's approval. For reading a page use fetch_url.",
    args: { url: "https URL", "method?": "GET, POST, PUT, PATCH or DELETE", "headers?": "object of header names to values", "body?": "request body text" },
    protected: true,
  },
  { name: "view_image", description: "Look at an image file of the project (PNG, JPEG, WebP, GIF), when your model reads images.", args: { path: "image file relative to the project" }, protected: false },
  {
    name: "conversation_remind",
    description: "Set yourself a reminder: after the delay this chat gets a turn with your note, as if the person had written. Use it to come back to long work instead of waiting.",
    args: { text: "what to do when it is due", "in_minutes?": "delay in minutes (default 10, at most 10080)" },
    protected: false,
  },
  { name: "conversation_reminders", description: "List this chat's reminders that are not yet due.", args: {}, protected: false },
  { name: "conversation_cancel_reminder", description: "Cancel one of this chat's reminders.", args: { id: "the reminder's id" }, protected: false },
  {
    name: "run_agent",
    description: "Hand one self-contained task to a sub-agent with the read-only tools (files, Lean checks, web), and get its final answer. It cannot write, run commands or start runs.",
    args: { task: "the whole task, with everything the sub-agent needs to know" },
    protected: false,
  },
  { name: "skills_load", description: "Load a published skill into the project's .skill folder from a URL of its SKILL.md.", args: { url: "https URL of a SKILL.md" }, protected: false },
];

/** Tools a sub-agent is offered: reading and checking, nothing that changes anything or spends budget. */
export const SUB_AGENT_TOOLS = ["list_files", "read_file", "search_files", "check_lean", "verify_lean", "web_search", "fetch_url", "view_image"];

/** Tools other features add to the chat (Ultramath, proof search, MCP servers); run through the same guard. */
const EXTRA: ToolSpec[] = [];

export function registerTools(specs: ToolSpec[]): void {
  for (const s of specs) {
    const i = EXTRA.findIndex((x) => x.name === s.name);
    if (i >= 0) EXTRA[i] = s;
    else EXTRA.push(s);
  }
}

export function unregisterTools(names: string[]): void {
  for (const n of names) {
    const i = EXTRA.findIndex((x) => x.name === n);
    if (i >= 0) EXTRA.splice(i, 1);
  }
}

/** The specs of `allowed` (all when absent), in registry order. */
export function toolSpecs(allowed?: string[]): ToolSpec[] {
  const all = [...TOOL_SPECS, ...EXTRA];
  return allowed ? all.filter((t) => allowed.includes(t.name)) : all;
}

export type ToolCall = { name: string; args: Record<string, unknown> };

/** An image's media type by its first bytes (PNG, JPEG, WebP, GIF), or undefined. */
export function imageType(b: Uint8Array): string | undefined {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return undefined;
}

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** A project image as a data URL, checked by its bytes and size. */
export async function imageDataUrl(root: string, p: string): Promise<string> {
  const file = await confine(root, p);
  const bytes = new Uint8Array(await readFile(file));
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("the image is larger than 4 MiB");
  const type = imageType(bytes);
  if (!type) throw new Error("that file is not a PNG, JPEG, WebP or GIF image");
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}
export type ToolResult = { ok: boolean; output: string };

const MAX_OUTPUT = 20_000;
export const truncate = (s: string, max = MAX_OUTPUT) => (s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s);

/** Resolve `p` inside `root`, following symbolic links of what exists; throws when it would leave the root. */
export async function confine(root: string, p: unknown): Promise<string> {
  if (typeof p !== "string") throw new Error("path must be a string");
  if (isAbsolute(p) || /^[a-zA-Z]:/.test(p)) throw new Error("use a path relative to the project folder");
  const realRoot = await realpath(root);
  const full = resolve(realRoot, p);
  const inside = (q: string) => q === realRoot || q.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  if (!inside(full)) throw new Error("the path leaves the project folder");
  // The deepest part that exists, resolved through links, must stay inside too.
  let probe = full;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  if (!inside(await realpath(probe))) throw new Error("the path leaves the project folder through a link");
  return full;
}

export async function listFiles(root: string, p = "."): Promise<string> {
  const dir = await confine(root, p);
  const entries = await readdir(dir, { withFileTypes: true });
  const lines = entries
    .filter((e) => !e.name.startsWith(".mack"))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  return lines.length ? lines.join("\n") : "(empty)";
}

export async function pdfText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => `--- page ${i + 1} ---\n${t}`).join("\n");
}

export async function readProjectFile(root: string, p: string, offset = 1, limit = 400): Promise<string> {
  const file = await confine(root, p);
  const s = await stat(file);
  if (s.isDirectory()) throw new Error("that is a folder; use list_files");
  const text = file.toLowerCase().endsWith(".pdf") ? await pdfText(new Uint8Array(await readFile(file))) : await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, Math.floor(offset));
  const slice = lines.slice(start - 1, start - 1 + Math.max(1, Math.floor(limit)));
  const more = lines.length > start - 1 + slice.length ? `\n… (${lines.length} lines in all; read on with offset ${start + slice.length})` : "";
  return slice.map((l, i) => `${start + i}\t${l}`).join("\n") + more;
}

const TEXT_EXT = /\.(lean|md|txt|tex|json|toml|py|ts|js|csv|bib)$/i;

export async function searchFiles(root: string, pattern: string, p = "."): Promise<string> {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch (e) {
    throw new Error(`bad pattern: ${(e as Error).message}`);
  }
  const base = await confine(root, p);
  const realRoot = await realpath(root);
  const hits: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 8 || hits.length >= 200) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (TEXT_EXT.test(e.name) && (await stat(full)).size < 2_000_000) {
        const lines = (await readFile(full, "utf8")).split(/\r?\n/);
        lines.forEach((l, i) => {
          if (hits.length < 200 && re.test(l)) hits.push(`${relative(realRoot, full)}:${i + 1}: ${l.trim().slice(0, 200)}`);
        });
      }
    }
  };
  await walk(base, 0);
  return hits.length ? hits.join("\n") : "no matches";
}

export async function writeProjectFile(root: string, p: string, content: string): Promise<string> {
  const file = await confine(root, p);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return `wrote ${relative(await realpath(root), file)} (${Buffer.byteLength(content, "utf8")} bytes)`;
}

/** Parse the ```tool blocks of a reply: each holds one JSON object {"name", "args"}. */
export function parseToolCalls(reply: string, allowed?: string[]): { calls: ToolCall[]; errors: string[] } {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const calls: ToolCall[] = [];
  const errors: string[] = [];
  for (const m of text.matchAll(/```tool\s*\n([\s\S]*?)```/g)) {
    try {
      const v = JSON.parse(m[1]) as { name?: unknown; args?: unknown };
      if (typeof v.name !== "string") throw new Error("missing \"name\"");
      if (!toolSpecs(allowed).some((t) => t.name === v.name)) throw new Error(`\`${v.name}\` is not one of your tools`);
      const args = v.args && typeof v.args === "object" && !Array.isArray(v.args) ? (v.args as Record<string, unknown>) : {};
      calls.push({ name: v.name, args });
    } catch (e) {
      errors.push(`A tool block could not be read: ${(e as Error).message}`);
    }
  }
  return { calls, errors };
}

/** The reply with its tool blocks removed: what the person reads. */
export function visibleText(reply: string): string {
  return reply
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```tool\s*\n[\s\S]*?```/g, "")
    .replace(/<citation_entries>[\s\S]*?<\/citation_entries>/g, "")
    .trim();
}

export function toolsPrompt(allowed?: string[]): string {
  const lines = toolSpecs(allowed).map((t) => {
    const args = Object.entries(t.args)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    return `- \`${t.name}\`${t.protected ? " (protected: waits for the person's approval)" : ""}: ${t.description} Arguments: ${args || "none"}.`;
  });
  return `To use a tool, put a block like this in your reply (one JSON object per block; several blocks run in order):
\`\`\`tool
{"name": "read_file", "args": {"path": "notes.md"}}
\`\`\`
The results come back in the next message. A reply with no tool block is your answer to the person and ends your turn.

Tools:
${lines.join("\n")}`;
}
