import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { citations, CUT_OFF, NO_ANSWER, NUDGE, RECOVER, runSubAgent, runTurn, toModelMessages, type ChatSession, type StoredMessage } from "../core/chat/agent";
import { execute, type ExecutorContext, type SessionHooks } from "../core/chat/executor";
import { JobManager, runCommand } from "../core/chat/shell";
import { frontMatter, listSkills } from "../core/chat/skills";
import { oneLine } from "../core/chat/suggestions";
import { imageType, registerTools, SUB_AGENT_TOOLS, toolSpecs, unregisterTools } from "../core/chat/tools";
import { OpenAICompatibleProvider } from "../core/model/openai-compatible";
import type { ChatRequest, ModelProvider } from "../core/model/provider";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mack-core-"));
});
afterAll(async () => rm(root, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function scripted(replies: string[] | ((req: ChatRequest, i: number) => string)): ModelProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let i = 0;
  return {
    name: "fake",
    requests,
    listModels: async () => [],
    chat: async (r) => {
      requests.push(r);
      const text = typeof replies === "function" ? replies(r, i++) : replies[Math.min(i++, replies.length - 1)];
      r.onDelta?.(text);
      return { content: text };
    },
  };
}

const session = (messages: StoredMessage[]): ChatSession => ({ id: "s", projectId: "p", title: "t", startedAt: 0, updatedAt: 0, messages });

describe("provider: streaming, reasoning, images, retries", () => {
  it("streams server-sent events and reads usage", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    });
    const pieces: string[] = [];
    const p = new OpenAICompatibleProvider("X", "https://x.test/v1", "k", { reasoning: "openrouter" });
    const r = await p.chat({ model: "m", messages: [{ role: "user", content: "hi", images: ["data:image/png;base64,AA=="] }], reasoningEffort: "high", onDelta: (t) => pieces.push(t) });
    expect(r).toEqual({ content: "Hello", usage: { promptTokens: 4, completionTokens: 2 } });
    expect(pieces).toEqual(["Hel", "lo"]);
    expect(body).toMatchObject({ stream: true, reasoning: { effort: "high" } });
    expect((body.messages as { content: unknown }[])[0].content).toEqual([
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ]);
  });

  it("sends reasoning_effort in the OpenAI dialect and retries a 503 once", async () => {
    let calls = 0;
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return ++calls === 1 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });
    const p = new OpenAICompatibleProvider("X", "https://x.test/v1", "k", { backoffMs: 1 });
    expect((await p.chat({ model: "m", messages: [], reasoningEffort: "low" })).content).toBe("ok");
    expect(calls).toBe(2);
    expect(body.reasoning_effort).toBe("low");
  });

  it("marks a reply that stopped at max_tokens as truncated", async () => {
    const sse = ['data: {"choices":[{"delta":{"content":""},"finish_reason":"length"}]}', "data: [DONE]", ""].join("\n\n");
    vi.stubGlobal("fetch", async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const p = new OpenAICompatibleProvider("X", "https://x.test/v1", "k");
    expect(await p.chat({ model: "m", messages: [], onDelta: () => {} })).toEqual({ content: "", usage: undefined, truncated: true });
  });

  it("does not retry a refusal", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => (calls++, new Response("bad key", { status: 401 })));
    await expect(new OpenAICompatibleProvider("X", "https://x.test/v1", "k", { backoffMs: 1 }).chat({ model: "m", messages: [] })).rejects.toThrow("401");
    expect(calls).toBe(1);
  });
});

describe("agent turn", () => {
  it("nudges once after an empty reply that followed tool work", async () => {
    const provider = scripted(['```tool\n{"name": "list_files", "args": {}}\n```', "", "Here is the answer."]);
    const s = session([{ role: "user", content: "look", at: 0 }]);
    await runTurn(s, { provider, model: "m", projectName: "P", memory: "", execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests.length).toBe(3);
    expect(provider.requests[2].messages.at(-1)?.content).toContain(NUDGE);
  });

  it("asks a reply cut off while thinking for just the next step, with low effort, and goes on", async () => {
    const replies = [{ content: "", truncated: true }, { content: '```tool\n{"name": "list_files", "args": {}}\n```' }, { content: "Done." }];
    const provider: ModelProvider & { requests: ChatRequest[] } = {
      name: "fake",
      requests: [],
      listModels: async () => [],
      chat: async (r) => (provider.requests.push(r), replies[provider.requests.length - 1]),
    };
    const s = session([{ role: "user", content: "start next step then", at: 0 }]);
    await runTurn(s, { provider, model: "m", projectName: "P", memory: "", effort: "medium", execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests.map((r) => r.reasoningEffort)).toEqual(["medium", "low", "low"]);
    expect(provider.requests[1].messages.at(-1)?.content).toContain(RECOVER);
    expect(s.messages.at(-1)).toMatchObject({ role: "assistant", content: "Done." });
  });

  it("stops and says why when the retry is cut off too", async () => {
    const provider: ModelProvider & { requests: ChatRequest[] } = {
      name: "fake",
      requests: [],
      listModels: async () => [],
      chat: async (r) => (provider.requests.push(r), { content: "", truncated: true }),
    };
    const s = session([{ role: "user", content: "look", at: 0 }]);
    await runTurn(s, { provider, model: "m", projectName: "P", memory: "", execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests.length).toBe(2);
    expect(s.messages.at(-1)).toMatchObject({ role: "assistant", content: CUT_OFF });
  });

  it("says so when the reply after the nudge is empty too", async () => {
    const provider = scripted(['```tool\n{"name": "list_files", "args": {}}\n```', "", ""]);
    const s = session([{ role: "user", content: "look", at: 0 }]);
    await runTurn(s, { provider, model: "m", projectName: "P", memory: "", execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests.length).toBe(3);
    expect(s.messages.at(-1)).toMatchObject({ role: "assistant", content: NO_ANSWER });
  });

  it("takes send-now messages between steps", async () => {
    const provider = scripted(['```tool\n{"name": "list_files", "args": {}}\n```', "Done."]);
    const s = session([{ role: "user", content: "look", at: 0 }]);
    let given = false;
    await runTurn(s, {
      provider,
      model: "m",
      projectName: "P",
      memory: "",
      execute: (c) => execute(c, { root, policy: {}, ask: async () => false }),
      takeSendNow: () => (given ? [] : ((given = true), [{ role: "user", content: "also check primes.lean", at: 1, source: "person" }])),
      onEvent: () => {},
    });
    expect(provider.requests[1].messages.at(-1)?.content).toBe("also check primes.lean");
  });

  it("frames reminders and job reports, and sends images only to vision models", () => {
    const msgs: StoredMessage[] = [
      { role: "user", content: "check the run", at: 0, source: "reminder" },
      { role: "user", content: "see", at: 0, attachments: [{ path: "uploads/a.png", kind: "image", image: "data:image/png;base64,AA==" }] },
    ];
    const plain = toModelMessages("sys", msgs);
    expect(plain[1].content).toMatch(/reminder you set earlier.*not the person's words/s);
    expect(plain[2].images).toBeUndefined();
    expect(plain[2].content).toContain("uploads/a.png");
    expect(toModelMessages("sys", msgs, true)[2].images).toEqual(["data:image/png;base64,AA=="]);
  });

  it("writes a checkpoint when the context grows too long", async () => {
    const long = "x".repeat(30_000);
    const msgs: StoredMessage[] = [];
    for (let i = 0; i < 6; i++) msgs.push({ role: "user", content: long, at: i }, { role: "assistant", content: "ok", at: i });
    msgs.push({ role: "user", content: "and now?", at: 9 });
    const provider = scripted((r) => (r.messages[0].content.startsWith("You are writing a CONTEXT CHECKPOINT") ? "SUMMARY: tried induction, failed at step 2." : "Answer."));
    const s = session(msgs);
    await runTurn(s, { provider, model: "m", projectName: "P", memory: "", execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(s.checkpoint?.summary).toContain("tried induction");
    const last = provider.requests.at(-1)!.messages;
    expect(last[1].content).toContain("SUMMARY: tried induction");
    expect(last.reduce((n, m) => n + m.content.length, 0)).toBeLessThan(120_000);
  });

  it("collects memory citations", () => {
    expect(citations("Answer.\n<citation_entries>\nThe proof uses Nat.rec|note=[it worked]\n</citation_entries>")).toEqual(["The proof uses Nat.rec|note=[it worked]"]);
  });

  it("runs a sub-agent with read-only tools", async () => {
    const provider = scripted(['```tool\n{"name": "write_file", "args": {"path": "x", "content": "y"}}\n```', "The folder is empty."]);
    const answer = await runSubAgent("what is here?", { provider, model: "m", projectName: "P", memory: "", tools: SUB_AGENT_TOOLS, execute: (c) => execute(c, { root, policy: {}, ask: async () => true }) });
    expect(answer).toBe("The folder is empty.");
    expect(provider.requests[1].messages.at(-1)?.content).toContain("is not one of your tools");
    expect(provider.requests[0].messages[0].content).not.toContain("`write_file`");
  });
});

describe("new tools", () => {
  const hooks = (over: Partial<SessionHooks> = {}): SessionHooks => ({
    id: "s",
    vision: true,
    jobs: new JobManager(() => {}),
    remind: (t, m) => `set ${t} in ${m}`,
    reminders: () => "none",
    cancelReminder: (id) => `cancelled ${id}`,
    subAgent: async (t) => `sub: ${t}`,
    ...over,
  });
  const ctx = (h = hooks(), ask: ExecutorContext["ask"] = async () => true): ExecutorContext => ({ root, policy: {}, ask, session: h });

  it("runs approved shell commands in the project folder, and nothing when denied", async () => {
    const ok = await execute({ name: "shell_exec", args: { command: "Write-Output hello-mack" } }, ctx());
    expect(ok).toMatchObject({ ok: true, decision: "approved" });
    expect(ok.output).toContain("hello-mack");
    expect(ok.output).toContain("exit code 0");
    const denied = await execute({ name: "shell_exec", args: { command: "Write-Output nope" } }, ctx(hooks(), async () => false));
    expect(denied).toMatchObject({ ok: false, decision: "denied" });
  }, 30_000);

  it("stops a command at its deadline", async () => {
    const r = await runCommand(root, "Start-Sleep -Seconds 20", 1500);
    expect(r.timedOut).toBe(true);
  }, 30_000);

  it("reports background jobs when they end", async () => {
    const ended = new Promise<string>((resolve) => {
      const jobs = new JobManager((j) => resolve(j.result!.output));
      void execute({ name: "shell_exec", args: { command: "Write-Output bg-done", background: true } }, ctx(hooks({ jobs })));
    });
    expect(await ended).toContain("bg-done");
  }, 30_000);

  it("removes files only with approval, never the project folder", async () => {
    await writeFile(join(root, "gone.txt"), "x");
    expect(await execute({ name: "remove_file", args: { path: "gone.txt" } }, ctx())).toMatchObject({ ok: true });
    await expect(readFile(join(root, "gone.txt"))).rejects.toThrow();
    expect((await execute({ name: "remove_file", args: { path: "." } }, ctx())).output).toContain("not removed");
  });

  it("hands images to vision models and refuses non-images", async () => {
    await writeFile(join(root, "pic.png"), PNG);
    const r = await execute({ name: "view_image", args: { path: "pic.png" } }, ctx());
    expect(r.images?.[0]).toMatch(/^data:image\/png;base64,/);
    expect(imageType(PNG)).toBe("image/png");
    await writeFile(join(root, "fake.png"), "not an image");
    expect((await execute({ name: "view_image", args: { path: "fake.png" } }, ctx())).ok).toBe(false);
    expect((await execute({ name: "view_image", args: { path: "pic.png" } }, ctx(hooks({ vision: false })))).images).toBeUndefined();
  });

  it("routes reminders and sub-agents to the session, and refuses local HTTP", async () => {
    expect((await execute({ name: "conversation_remind", args: { text: "check", in_minutes: 5 } }, ctx())).output).toBe("set check in 5");
    expect((await execute({ name: "run_agent", args: { task: "read" } }, ctx())).output).toBe("sub: read");
    expect((await execute({ name: "http_request", args: { url: "https://127.0.0.1/x" } }, ctx())).output).toContain("local");
    expect((await execute({ name: "conversation_reminders", args: {} }, { root, policy: {}, ask: async () => true })).output).toContain("only available in a chat");
  });

  it("runs registered extra tools through the same guard", async () => {
    registerTools([{ name: "demo_start", description: "d", args: {}, protected: true }]);
    let asked = false;
    const r = await execute({ name: "demo_start", args: {} }, { root, policy: {}, ask: async () => ((asked = true), true), extra: (c) => (c.name === "demo_start" ? Promise.resolve("started") : undefined) });
    expect(r).toMatchObject({ ok: true, output: "started", decision: "approved" });
    expect(asked).toBe(true);
    expect(toolSpecs().some((t) => t.name === "demo_start")).toBe(true);
    unregisterTools(["demo_start"]);
  });
});

describe("skills and suggestions", () => {
  it("reads skill front matter and lists project skills", async () => {
    expect(frontMatter("---\nname: lean-golf\ndescription: Shorten Lean proofs\n---\nSteps")).toEqual({ name: "lean-golf", description: "Shorten Lean proofs" });
    expect(frontMatter("no front matter")).toBeUndefined();
    expect(frontMatter("---\nname: Bad Name\n---")).toBeUndefined();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, ".skill", "lean-golf"), { recursive: true });
    await writeFile(join(root, ".skill", "lean-golf", "SKILL.md"), "---\nname: lean-golf\ndescription: Shorten Lean proofs\n---\n");
    expect(await listSkills(root)).toEqual([{ name: "lean-golf", description: "Shorten Lean proofs" }]);
  });

  it("cleans one-line suggestions", () => {
    expect(oneLine('<think>hmm</think>"Prove the lemma for n = 0."\nextra', 200)).toBe("Prove the lemma for n = 0");
    expect(oneLine("  ", 10)).toBeNull();
  });
});
