import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACT_NUDGE, announcesWork, runTurn, type ChatSession } from "../core/chat/agent";
import { execute } from "../core/chat/executor";
import { parseToolCalls } from "../core/chat/tools";
import type { ChatRequest, ModelProvider } from "../core/model/provider";

function scripted(replies: string[]): ModelProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let i = 0;
  return { name: "fake", requests, listModels: async () => [], chat: async (r) => (requests.push(r), { content: replies[Math.min(i++, replies.length - 1)] }) };
}
const session = (text: string): ChatSession => ({ id: "s", projectId: "p", title: "t", startedAt: 0, updatedAt: 0, messages: [{ role: "user", content: text, at: 0 }] });

describe("tool calls written the ways models write them", () => {
  it("reads <tool_call> tags, `arguments` in place of `args`, and a ```json block that names a tool", () => {
    expect(parseToolCalls('<tool_call>{"name": "web_search", "arguments": {"query": "odd perfect"}}</tool_call>').calls).toEqual([{ name: "web_search", args: { query: "odd perfect" } }]);
    expect(parseToolCalls('```tool\n{"name": "web_search", "arguments": "{\\"query\\": \\"x\\"}"}\n```').calls).toEqual([{ name: "web_search", args: { query: "x" } }]);
    expect(parseToolCalls('Searching.\n```json\n{"name": "web_search", "args": {"query": "y"}}\n```').calls).toEqual([{ name: "web_search", args: { query: "y" } }]);
  });

  it("leaves ordinary JSON shown to the person alone", () => {
    expect(parseToolCalls('The result:\n```json\n{"n": 6, "divisors": [1, 2, 3]}\n```')).toEqual({ calls: [], errors: [] });
    expect(parseToolCalls('```json\n{"name": "not_a_tool", "args": {}}\n```')).toEqual({ calls: [], errors: [] });
  });
});

describe("a turn that says what it will do without doing it", () => {
  it("recognises an announcement, not an answer or a question", () => {
    expect(announcesWork("I'll refresh the literature check first, using the web search feature.")).toBe(true);
    expect(announcesWork("Let me look that up.")).toBe(true);
    expect(announcesWork("Shall I start with the literature?")).toBe(false);
    expect(announcesWork("Euler's form says an odd perfect number is p^k m^2.")).toBe(false);
  });

  it("is sent back once with the call format, and then acts", async () => {
    const root = await mkdtemp(join(tmpdir(), "mack-act-"));
    const provider = scripted(["I'll search the literature first.", '```tool\n{"name": "list_files", "args": {}}\n```', "Found the files; the literature step is next."]);
    const s = session("solve it");
    await runTurn(s, { provider, model: "m", projectName: "P", memory: "", execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[1].messages.at(-1)?.content).toContain(ACT_NUDGE);
    expect(provider.requests[1].messages.at(-1)?.content).toContain("Mack's own note");
    expect(s.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("on Autopilot, any reply without a call is sent back once, but only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "mack-act-"));
    const provider = scripted(["The goal is still open.", "I cannot continue without your API key."]);
    await runTurn(session("go"), { provider, model: "m", projectName: "P", memory: "", auto: () => true, execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests).toHaveLength(2);
  });

  it("leaves a plain answer outside Autopilot alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "mack-act-"));
    const provider = scripted(["An odd perfect number, if one exists, has at least ten distinct prime factors."]);
    await runTurn(session("what is known?"), { provider, model: "m", projectName: "P", memory: "", execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests).toHaveLength(1);
  });
});
