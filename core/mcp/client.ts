// An MCP client for stdio and Streamable HTTP servers, adapted from
// open-math-harness `program-files/mcp` (Apache-2.0). Only the tools a
// connection maps are published; a mapped tool the server does not list
// fails the connection. A stdio line, an HTTP JSON body and a whole SSE
// response are each read up to 1 MiB. A stdio server is a child process of
// Mack that ends when its connection closes; it gets the environment Mack
// has, minus Mack's provider keys. Cancellation closes the call; an MCP tool
// call that was cut off has an unknown outcome and is never retried.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { killTree } from "../lean/toolchain";

export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const PROTOCOL_VERSION = "2025-06-18";

export type McpTool = { name: string; description: string; inputSchema: unknown };
export type McpTarget = { command: string; args: string[]; cwd: string } | { url: string };

type Json = Record<string, unknown>;

interface Transport {
  request(message: Json, timeoutMs: number, signal?: AbortSignal): Promise<Json>;
  notify(message: Json): Promise<void>;
  close(): void;
}

/** Keys of model providers never reach a server's environment. */
const SECRET_ENV = /^(FIREWORKS_API_KEY|OPENROUTER_API_KEY|CUSTOM_API_KEY|GH_TOKEN|GITHUB_TOKEN)$/i;

class StdioTransport implements Transport {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private waiting = new Map<number | string, (m: Json) => void>();
  private closed: string | null = null;
  stderr = "";

  constructor(command: string, args: string[], cwd: string) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k)));
    this.child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" && !/\.(exe|com)$/i.test(command) });
    this.child.stdout.on("data", (d: Buffer) => {
      this.buffer += d.toString("utf8");
      let i: number;
      while ((i = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line) as Json;
          if (m.id !== undefined && this.waiting.has(m.id as number)) {
            this.waiting.get(m.id as number)!(m);
            this.waiting.delete(m.id as number);
          }
        } catch {
          // Not a JSON-RPC line: servers sometimes log to stdout.
        }
      }
      if (this.buffer.length > MAX_MESSAGE_BYTES) this.fail("the server sent a line longer than 1 MiB");
    });
    this.child.stderr.on("data", (d: Buffer) => (this.stderr = (this.stderr + d.toString("utf8")).slice(-4000)));
    this.child.on("error", (e) => this.fail(`could not start the server: ${e.message}`));
    this.child.on("close", (code) => this.fail(`the server exited with ${code}${this.stderr ? `: ${this.stderr.trim().slice(-500)}` : ""}`));
  }

  private fail(why: string) {
    if (this.closed) return;
    this.closed = why;
    for (const w of this.waiting.values()) w({ error: { message: why } });
    this.waiting.clear();
    killTree(this.child);
  }

  request(message: Json, timeoutMs: number, signal?: AbortSignal): Promise<Json> {
    if (this.closed) return Promise.reject(new Error(this.closed));
    return new Promise((resolve, reject) => {
      const id = message.id as number;
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`the server did not answer within ${timeoutMs} ms`));
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(new Error("cancelled"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiting.set(id, (m) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(m);
      });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async notify(message: Json): Promise<void> {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.fail("closed");
  }
}

/** Read a response body up to 1 MiB. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MESSAGE_BYTES) {
      await reader.cancel();
      throw new Error("the server's response is larger than 1 MiB");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

class HttpTransport implements Transport {
  private session: string | null = null;

  constructor(private readonly url: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) throw new Error("an HTTP MCP server must use https (or http on localhost)");
  }

  private async post(message: Json, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL_VERSION };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(message), signal });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    return res;
  }

  async request(message: Json, timeoutMs: number, signal?: AbortSignal): Promise<Json> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    signal?.addEventListener("abort", () => ctl.abort(), { once: true });
    try {
      const res = await this.post(message, ctl.signal);
      if (!res.ok) throw new Error(`the server returned HTTP ${res.status}`);
      const text = await readCapped(res);
      if ((res.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
        // The response to our request is one of the stream's `data:` events.
        for (const block of text.split(/\r?\n\r?\n/)) {
          const data = block
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (!data) continue;
          try {
            const m = JSON.parse(data) as Json;
            if (m.id === message.id) return m;
          } catch {
            // Not JSON: skip.
          }
        }
        throw new Error("the server's event stream held no response to the request");
      }
      return JSON.parse(text) as Json;
    } catch (e) {
      if (ctl.signal.aborted && !signal?.aborted) throw new Error(`the server did not answer within ${timeoutMs} ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async notify(message: Json): Promise<void> {
    await this.post(message).catch(() => {});
  }

  close(): void {
    if (this.session) void fetch(this.url, { method: "DELETE", headers: { "Mcp-Session-Id": this.session } }).catch(() => {});
  }
}

export class McpClient {
  private next = 1;
  private transport: Transport;
  tools: McpTool[] = [];

  private constructor(transport: Transport, readonly timeoutMs: number) {
    this.transport = transport;
  }

  /** Connect, initialize and list the server's tools; publish only `map` (all when empty). */
  static async connect(target: McpTarget, opts: { timeoutMs?: number; map?: string[]; signal?: AbortSignal } = {}): Promise<McpClient> {
    const transport = "url" in target ? new HttpTransport(target.url) : new StdioTransport(target.command, target.args, target.cwd);
    const c = new McpClient(transport, opts.timeoutMs ?? 60_000);
    try {
      await c.call("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "mack", version: "0.2" } }, opts.signal);
      await transport.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
      const listed: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 16; page++) {
        const r = (await c.call("tools/list", cursor ? { cursor } : {}, opts.signal)) as { tools?: McpTool[]; nextCursor?: string };
        listed.push(...(r.tools ?? []));
        cursor = r.nextCursor;
        if (!cursor) break;
        if (page === 15) throw new Error("MCP tools/list exceeds 16 pages");
      }
      const map = opts.map?.length ? opts.map : listed.map((t) => t.name);
      const missing = map.filter((n) => !listed.some((t) => t.name === n));
      if (missing.length) throw new Error(`the server lists no tool ${missing.map((m) => `\`${m}\``).join(", ")}`);
      c.tools = listed.filter((t) => map.includes(t.name));
      return c;
    } catch (e) {
      transport.close();
      throw e;
    }
  }

  private async call(method: string, params: Json, signal?: AbortSignal): Promise<unknown> {
    const id = this.next++;
    const r = await this.transport.request({ jsonrpc: "2.0", id, method, params }, this.timeoutMs, signal);
    if (r.error) throw new Error(`MCP ${method}: ${(r.error as { message?: string }).message ?? "error"}`);
    return r.result;
  }

  /** Call one published tool; its text content is the result. */
  async callTool(name: string, args: Json, signal?: AbortSignal): Promise<string> {
    if (!this.tools.some((t) => t.name === name)) throw new Error(`\`${name}\` is not a published tool of this server`);
    const r = (await this.call("tools/call", { name, arguments: args }, signal)) as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
    const text = (r.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type} content]`)).join("\n") || (r.structuredContent ? JSON.stringify(r.structuredContent) : "");
    if (r.isError) throw new Error(text || "the tool reported an error");
    return text;
  }

  close(): void {
    this.transport.close();
  }
}
