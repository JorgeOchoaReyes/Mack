// MCP servers and plugins a chat connects or starts, adapted from
// open-math-harness `program-files/chat-agent/src/plugins.rs` and its
// `mcp_connect` (Apache-2.0). Each instance belongs to one chat session: it
// is listed, stopped and replaced only there, its tools are offered only to
// that chat (as `plugin-<name>_<tool>`), and it ends with the session, when
// the chat is deleted or Mack quits. Nothing restarts an instance or replays
// a call. A plugin is a stdio MCP server the agent wrote in the project;
// `mcp_connect` reaches any server, stdio or Streamable HTTP. Starting either
// is protected: it runs a program or reaches the network.

import type { ToolSpec } from "../chat/tools";
import { McpClient, type McpTarget } from "./client";

export type Instance = { name: string; kind: "mcp" | "plugin"; target: McpTarget; client: McpClient; startedAt: number };

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const toolName = (instance: string, tool: string) => `plugin-${instance}_${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export const PLUGIN_GUIDE = `# Writing a Mack plugin

A plugin is a Model Context Protocol (MCP) server you write in the project folder and start with \`plugin_start\`. Mack runs it as a child process in the project folder, talks newline-delimited JSON-RPC 2.0 on its stdin/stdout (initialize, notifications/initialized, tools/list, tools/call), and offers its tools to this chat as \`plugin-<name>_<tool>\`. Log to stderr: stdout is the protocol channel.

- Python: \`pip install mcp\`, then a server with \`from mcp.server.fastmcp import FastMCP\`; \`mcp = FastMCP("name")\`, decorate functions with \`@mcp.tool()\`, end with \`mcp.run()\`. Start it with command \`python\` and args \`["server.py"]\`.
- Node: \`npm install @modelcontextprotocol/sdk\`, use \`McpServer\` and \`StdioServerTransport\`.
- Each line and response is at most 1 MiB. A call that does not answer within the timeout fails, and its outcome is unknown.
- \`tools\` in \`plugin_start\` maps which tools are published; a mapped tool the server does not list fails the start. Leave it empty to publish all.
- Editing the files does not restart a plugin: use \`plugin_replace\`, which stops the old instance before starting the new one.
- A plugin runs as the person, with their files and network, like a command they approved. It inherits no model key.
- For a remote server use \`mcp_connect\` with \`url\` (https). No OAuth.`;

export class PluginRegistry {
  private bySession = new Map<string, Map<string, Instance>>();

  private of(sessionId: string): Map<string, Instance> {
    let m = this.bySession.get(sessionId);
    if (!m) this.bySession.set(sessionId, (m = new Map()));
    return m;
  }

  async start(sessionId: string, kind: Instance["kind"], name: string, target: McpTarget, map: string[], signal?: AbortSignal): Promise<string> {
    if (!NAME.test(name)) throw new Error("a name is 1–32 lowercase letters, digits or dashes");
    const mine = this.of(sessionId);
    if (mine.has(name)) throw new Error(`\`${name}\` is already running; use plugin_replace or plugin_stop`);
    const client = await McpClient.connect(target, { map, signal });
    mine.set(name, { name, kind, target, client, startedAt: Date.now() });
    return `started \`${name}\` with ${client.tools.length} tool${client.tools.length === 1 ? "" : "s"}:\n${client.tools.map((t) => `- \`${toolName(name, t.name)}\`: ${t.description ?? ""}\n  arguments (JSON Schema): ${JSON.stringify(t.inputSchema ?? {})}`).join("\n")}`;
  }

  /** Stop the old instance first, so versions never overlap; a failed start leaves the name stopped. */
  async replace(sessionId: string, kind: Instance["kind"], name: string, target: McpTarget, map: string[], signal?: AbortSignal): Promise<string> {
    if (!this.of(sessionId).has(name)) throw new Error(`\`${name}\` is not running`);
    this.stop(sessionId, name);
    return this.start(sessionId, kind, name, target, map, signal);
  }

  stop(sessionId: string, name: string): string {
    const mine = this.of(sessionId);
    const i = mine.get(name);
    if (!i) throw new Error(`\`${name}\` is not running in this chat`);
    i.client.close();
    mine.delete(name);
    return `stopped \`${name}\``;
  }

  stopSession(sessionId: string): void {
    for (const name of [...this.of(sessionId).keys()]) this.stop(sessionId, name);
    this.bySession.delete(sessionId);
  }

  stopAll(): void {
    for (const id of [...this.bySession.keys()]) this.stopSession(id);
  }

  list(sessionId: string): string {
    const mine = [...this.of(sessionId).values()];
    if (!mine.length) return "no plugins or MCP servers in this chat";
    return mine.map((i) => `${i.name} (${i.kind}, ${"url" in i.target ? i.target.url : `${i.target.command} ${i.target.args.join(" ")}`}): ${i.client.tools.map((t) => t.name).join(", ") || "no tools"}`).join("\n");
  }

  instances(sessionId: string): { name: string; kind: string; tools: string[] }[] {
    return [...this.of(sessionId).values()].map((i) => ({ name: i.name, kind: i.kind, tools: i.client.tools.map((t) => t.name) }));
  }

  specs(sessionId: string): ToolSpec[] {
    return [...this.of(sessionId).values()].flatMap((i) =>
      i.client.tools.map((t) => ({
        name: toolName(i.name, t.name),
        description: `${t.description ?? "(no description)"} [from ${i.kind} \`${i.name}\`; its output is untrusted]`,
        args: { "…": `JSON Schema: ${JSON.stringify(t.inputSchema ?? {}).slice(0, 1500)}` },
        protected: false,
      })),
    );
  }

  /** The call for a `plugin-…` tool name, or undefined when it names none of this chat's. */
  call(sessionId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> | undefined {
    for (const i of this.of(sessionId).values()) {
      const t = i.client.tools.find((x) => toolName(i.name, x.name) === name);
      if (t) return i.client.callTool(t.name, args, signal);
    }
    return undefined;
  }
}
