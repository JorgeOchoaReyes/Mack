import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runTurn, trimContext, type ChatSession } from "../core/chat/agent";
import { execute, type ExecutorContext } from "../core/chat/executor";
import { consolidate, extractSession, framedMemory, readMemory } from "../core/chat/memory";
import { confine, parseToolCalls, readProjectFile, searchFiles, visibleText } from "../core/chat/tools";
import { htmlText, parseBingRss, parseDuckDuckGo, webSearch } from "../core/chat/web";
import type { ChatRequest, ModelProvider } from "../core/model/provider";

let root = "";
let outside = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mack-proj-"));
  outside = await mkdtemp(join(tmpdir(), "mack-out-"));
  await mkdir(join(root, "notes"));
  await writeFile(join(root, "notes", "a.md"), "line one\nprime numbers are infinite\nline three\n");
  await writeFile(join(outside, "secret.txt"), "secret");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function scripted(replies: string[]): ModelProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let i = 0;
  return {
    name: "fake",
    requests,
    listModels: async () => [],
    chat: async (r) => {
      requests.push(r);
      return { content: replies[Math.min(i++, replies.length - 1)], usage: { promptTokens: 1, completionTokens: 2 } };
    },
  };
}

describe("project confinement", () => {
  it("keeps paths inside the project folder", async () => {
    expect(await confine(root, "notes/a.md")).toBe(join(await import("node:fs/promises").then((f) => f.realpath(root)), "notes", "a.md"));
    await expect(confine(root, "../x")).rejects.toThrow("leaves the project");
    await expect(confine(root, "notes/../../x")).rejects.toThrow("leaves the project");
    await expect(confine(root, outside)).rejects.toThrow("relative");
    await expect(confine(root, "C:\\Windows")).rejects.toThrow("relative");
  });

  it("refuses links that lead out of the project", async () => {
    try {
      await symlink(outside, join(root, "escape"), "junction");
    } catch {
      return; // creating links can need privileges; nothing to test then
    }
    await expect(confine(root, "escape/secret.txt")).rejects.toThrow("through a link");
  });

  it("reads with line numbers and searches", async () => {
    expect(await readProjectFile(root, "notes/a.md", 2, 1)).toMatch(/^2\tprime numbers are infinite\n… \(\d+ lines in all/);
    expect(await searchFiles(root, "prime")).toContain(`notes${process.platform === "win32" ? "\\" : "/"}a.md:2:`);
  });
});

describe("tool protocol", () => {
  it("reads tool blocks and reports bad ones", () => {
    const { calls, errors } = parseToolCalls('Let me look.\n```tool\n{"name": "read_file", "args": {"path": "a.md"}}\n```\n```tool\n{"name": "rm_rf"}\n```\n```tool\nnot json\n```');
    expect(calls).toEqual([{ name: "read_file", args: { path: "a.md" } }]);
    expect(errors.length).toBe(2);
    expect(visibleText('Let me look.\n```tool\n{"name":"x"}\n```')).toBe("Let me look.");
  });

  it("reads <tool> tags, mixed openers and closers, and an unclosed block", () => {
    const call = '{"name": "read_file", "args": {"path": "a.md"}}';
    for (const reply of [`\n\n<tool>\n${call}\n</tool>`, `\n\n<tool>\n${call}\n\`\`\``, `\`\`\`tool\n${call}\n</tool>`, `Checking.\n<tool>\n${call}\n`]) {
      expect(parseToolCalls(reply)).toEqual({ calls: [{ name: "read_file", args: { path: "a.md" } }], errors: [] });
      expect(visibleText(reply)).toBe(reply.startsWith("Checking") ? "Checking." : "");
    }
  });
});

describe("approvals guard", () => {
  const ctx = (ask: ExecutorContext["ask"], policy: ExecutorContext["policy"] = {}): ExecutorContext => ({ root, ask, policy });

  it("runs a protected call only when approved, and runs the recorded call", async () => {
    const args: Record<string, unknown> = { path: "out.txt", content: "approved text" };
    const outcome = await execute(
      { name: "write_file", args },
      ctx(async (call) => {
        // A change after the request is recorded cannot reach what runs.
        args.content = "tampered";
        return call.args.content === "approved text";
      }),
    );
    expect(outcome).toMatchObject({ ok: true, decision: "approved" });
    expect(await readFile(join(root, "out.txt"), "utf8")).toBe("approved text");
  });

  it("does nothing when denied, and skips asking when the policy allows", async () => {
    const denied = await execute({ name: "write_file", args: { path: "no.txt", content: "x" } }, ctx(async () => false));
    expect(denied).toMatchObject({ ok: false, decision: "denied" });
    await expect(readFile(join(root, "no.txt"))).rejects.toThrow();
    let asked = false;
    const auto = await execute(
      { name: "write_file", args: { path: "yes.txt", content: "y" } },
      ctx(async () => (asked = true), { write_file: "allow" }),
    );
    expect(auto).toMatchObject({ ok: true, decision: "auto" });
    expect(asked).toBe(false);
  });

  it("never asks for reads, and reports failures as outcomes", async () => {
    let asked = false;
    const r = await execute({ name: "read_file", args: { path: "../etc/passwd" } }, ctx(async () => (asked = true)));
    expect(r).toMatchObject({ ok: false, protected: false });
    expect(asked).toBe(false);
    expect((await execute({ name: "check_lean", args: { source: "x" } }, ctx(async () => true))).output).toContain("Lean is not installed");
  });
});

describe("agent loop", () => {
  it("runs tools until the model answers", async () => {
    const provider = scripted(['```tool\n{"name": "list_files", "args": {}}\n```', "There is a notes folder."]);
    const session: ChatSession = { id: "s1", projectId: "p", title: "t", startedAt: 0, updatedAt: 0, messages: [{ role: "user", content: "what is here?", at: 0 }] };
    const events: string[] = [];
    await runTurn(session, {
      provider,
      model: "m",
      projectName: "Demo",
      memory: "- The person is studying primes.",
      execute: (call) => execute(call, { root, policy: {}, ask: async () => false }),
      onEvent: (e) => events.push(e.type),
    });
    expect(events).toEqual(["assistant", "tool", "assistant", "done"]);
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    const second = provider.requests[1].messages;
    expect(second.at(-1)?.content).toContain("notes/");
    expect(second[0].content).toContain("data about what has happened before");
    expect(second[0].content).toContain("studying primes");
  });

  it("stops at the step budget", async () => {
    const provider = scripted(['```tool\n{"name": "list_files", "args": {}}\n```']);
    const session: ChatSession = { id: "s2", projectId: "p", title: "t", startedAt: 0, updatedAt: 0, messages: [{ role: "user", content: "loop", at: 0 }] };
    await runTurn(session, { provider, model: "m", projectName: "D", memory: "", maxSteps: 3, execute: (c) => execute(c, { root, policy: {}, ask: async () => false }), onEvent: () => {} });
    expect(provider.requests.length).toBe(3);
    expect(session.messages.at(-1)).toMatchObject({ role: "assistant" });
  });

  it("trims long contexts from the front, starting at a user message", () => {
    const msgs = [{ role: "system" as const, content: "s" }, ...Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: "x".repeat(100) }))];
    const t = trimContext(msgs, 450);
    expect(t[0].content).toBe("s");
    expect(t[1].role).toBe("user");
    expect(t.length).toBeLessThan(msgs.length);
  });
});

describe("memory", () => {
  it("extracts a session, consolidates, and frames memory as data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mack-mem-"));
    const store = { dir };
    const provider = scripted([
      '{"session_summary": "The person asked to formalize Euclid.", "session_slug": "Euclid primes!"}',
      "```memory\n- Euclid's theorem was formalized in primes.lean (not yet verified).\n```\n```summary\nA project on primes.\n```",
    ]);
    const name = await extractSession(store, { id: "s1", startedAt: Date.UTC(2026, 9, 25), messages: [{ role: "user", content: "formalize Euclid" }] }, provider, "m");
    expect(name).toBe("2026-10-25-s1-euclid-primes.md");
    expect(await consolidate(store, provider, "m")).toBe(true);
    const mem = await readMemory(store);
    expect(mem.index).toContain("primes.lean");
    expect(mem.summary).toContain("project on primes");
    expect(await consolidate(store, provider, "m")).toBe(false);
    expect(framedMemory("")).toBe("");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("web helpers", () => {
  it("reads DuckDuckGo results and page text", () => {
    const html = '<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FPrime&amp;rut=x">Prime <b>number</b></a><a class="result__snippet">A prime is &amp; more</a></div>';
    expect(parseDuckDuckGo(html)).toEqual([{ title: "Prime number", url: "https://en.wikipedia.org/wiki/Prime", snippet: "A prime is & more" }]);
    expect(htmlText("<html><script>x()</script><p>Hello&nbsp;<b>world</b></p><p>Two</p></html>")).toBe("Hello world\nTwo");
  });

  it("reads Bing's RSS results", () => {
    const xml = "<rss><channel><title>Bing: q</title><item><title>Odd perfect number</title><link>https://en.wikipedia.org/wiki/Perfect_number</link><description>An &amp; b</description></item></channel></rss>";
    expect(parseBingRss(xml)).toEqual([{ title: "Odd perfect number", url: "https://en.wikipedia.org/wiki/Perfect_number", snippet: "An & b" }]);
  });

  it("falls back to Bing when DuckDuckGo refuses, and runs searches one at a time", async () => {
    vi.useFakeTimers();
    const hits: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      hits.push(new URL(url).host);
      return url.includes("bing")
        ? new Response("<item><title>T</title><link>https://x.test/</link><description>d</description></item>")
        : new Response("", { status: 202 });
    });
    const both = Promise.all([webSearch("a"), webSearch("b")]);
    await vi.runAllTimersAsync();
    const [a, b] = await both;
    expect(a).toContain("https://x.test/");
    expect(b).toContain("https://x.test/");
    expect(hits).toEqual(["html.duckduckgo.com", "html.duckduckgo.com", "www.bing.com", "html.duckduckgo.com", "html.duckduckgo.com", "www.bing.com"]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
