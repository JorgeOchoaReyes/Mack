import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute, type ExecutorContext } from "../core/chat/executor";
import { McpClient, type McpTarget } from "../core/mcp/client";
import { PluginRegistry, toolName } from "../core/mcp/plugins";

/** A minimal MCP server over newline-delimited JSON-RPC: one tool, `add`. */
const STDIO_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === "initialize") return send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "t", version: "1" } } });
  if (m.method === "tools/list") return send({ jsonrpc: "2.0", id: m.id, result: { tools: [
    { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
    { name: "secret", description: "not mapped", inputSchema: {} } ] } });
  if (m.method === "tools/call") {
    if (m.params.name === "add") return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: String(m.params.arguments.a + m.params.arguments.b) }] } });
    return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "no" }], isError: true } });
  }
});
console.error("server ready");
`;

let dir = "";
let http: Server;
let url = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mack-mcp-"));
  await writeFile(join(dir, "server.js"), STDIO_SERVER);
  // A Streamable HTTP server that answers tools/call as an event stream and keeps a session.
  http = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.method === "DELETE") return res.end();
      const m = JSON.parse(body);
      if (m.id === undefined) return res.writeHead(202).end();
      if (m.method !== "initialize" && req.headers["mcp-session-id"] !== "sess-1") return res.writeHead(400).end();
      const result =
        m.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "h", version: "1" } }
          : m.method === "tools/list"
            ? { tools: [{ name: "echo", description: "Echo", inputSchema: {} }] }
            : { content: [{ type: "text", text: `echo: ${m.params.arguments.text}` }] };
      if (m.method === "tools/call") {
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "sess-1" });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`);
      } else {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
      }
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const addr = http.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/mcp`;
});
afterAll(async () => {
  http?.close();
  // Server processes end asynchronously on Windows (taskkill); retry while their folder is in use.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe("MCP client", () => {
  it("talks to a stdio server, publishing only mapped tools", async () => {
    const c = await McpClient.connect({ command: process.execPath, args: ["server.js"], cwd: dir }, { map: ["add"] });
    expect(c.tools.map((t) => t.name)).toEqual(["add"]);
    expect(await c.callTool("add", { a: 2, b: 3 })).toBe("5");
    await expect(c.callTool("secret", {})).rejects.toThrow("not a published tool");
    c.close();
  });

  it("refuses a mapped tool the server does not list", async () => {
    await expect(McpClient.connect({ command: process.execPath, args: ["server.js"], cwd: dir }, { map: ["nope"] })).rejects.toThrow("lists no tool `nope`");
  });

  it("talks to a Streamable HTTP server with a session and an event-stream answer", async () => {
    const c = await McpClient.connect({ url });
    expect(await c.callTool("echo", { text: "hi" })).toBe("echo: hi");
    c.close();
  });

  it("refuses plain http to anything but localhost", async () => {
    await expect(McpClient.connect({ url: "http://example.org/mcp" })).rejects.toThrow("https");
  });
});

describe("plugins in a chat", () => {
  it("starts a plugin through the guard, offers its tools to that chat only, and stops it", async () => {
    const reg = new PluginRegistry();
    const asked: string[] = [];
    const ctx = (sessionId: string): ExecutorContext => ({
      root: dir,
      policy: {},
      ask: async (call) => (asked.push(call.name), true),
      ownTools: () => reg.specs(sessionId),
      extra: (c) => reg.call(sessionId, c.name, c.args),
      plugins: {
        start: (kind, name, target: McpTarget, map) => reg.start(sessionId, kind, name, target, map),
        replace: (name, target, map) => reg.replace(sessionId, "plugin", name, target, map),
        stop: (name) => reg.stop(sessionId, name),
        list: () => reg.list(sessionId),
      },
    });
    const started = await execute({ name: "plugin_start", args: { name: "calc", command: process.execPath, args: ["server.js"], tools: ["add"] } }, ctx("s1"));
    expect(started).toMatchObject({ ok: true, decision: "approved" });
    expect(asked).toEqual(["plugin_start"]);
    const add = toolName("calc", "add");
    expect((await execute({ name: add, args: { a: 40, b: 2 } }, ctx("s1"))).output).toBe("42");
    // Another chat does not have it.
    expect((await execute({ name: add, args: { a: 1, b: 1 } }, ctx("s2"))).ok).toBe(false);
    expect((await execute({ name: "plugin_replace", args: { name: "calc", command: process.execPath, args: ["server.js"] } }, ctx("s1"))).ok).toBe(true);
    expect((await execute({ name: "plugin_stop", args: { name: "calc" } }, ctx("s1"))).output).toContain("stopped");
    expect(reg.specs("s1")).toEqual([]);
  });
});
