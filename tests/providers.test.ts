import { afterEach, describe, expect, it, vi } from "vitest";
import { FireworksProvider } from "../core/model/fireworks";
import { OpenAICompatibleProvider } from "../core/model/openai-compatible";
import { PROVIDERS, providerInfo } from "../core/model/providers";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

describe("model providers", () => {
  it("lists Fireworks, OpenRouter and a custom endpoint, each with its own key variable", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["fireworks", "openrouter", "custom"]);
    expect(new Set(PROVIDERS.map((p) => p.keyEnv)).size).toBe(3);
    expect(providerInfo("custom").keyRequired).toBe(false);
  });

  it("calls the chat endpoint with the key and extra headers, and reads usage", async () => {
    const calls = stubFetch({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 3, completion_tokens: 5 } });
    const p = new OpenAICompatibleProvider("OpenRouter", "https://openrouter.ai/api/v1/", "sk-test", { extraHeaders: { "X-Title": "Mack" } });
    const r = await p.chat({ model: "m", messages: [{ role: "user", content: "x" }], maxTokens: 10 });
    expect(r).toEqual({ content: "hi", usage: { promptTokens: 3, completionTokens: 5 } });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["X-Title"]).toBe("Mack");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ model: "m", max_tokens: 10 });
  });

  it("sends no Authorization header when a local server has no key", async () => {
    const calls = stubFetch({ data: [{ id: "b" }, { id: "a" }] });
    const p = new OpenAICompatibleProvider("Local", "http://localhost:11434/v1", "");
    expect(await p.listModels()).toEqual(["a", "b"]);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("reports HTTP and in-body errors", async () => {
    stubFetch({ error: "nope" }, 401);
    await expect(new FireworksProvider("k").chat({ model: "m", messages: [] })).rejects.toThrow("Fireworks returned 401");
    stubFetch({ error: { message: "rate limited" } });
    await expect(new FireworksProvider("k").chat({ model: "m", messages: [] })).rejects.toThrow("rate limited");
  });

  it("refuses a missing Fireworks key and a non-http endpoint", () => {
    expect(() => new FireworksProvider("")).toThrow("no Fireworks API key");
    expect(() => new OpenAICompatibleProvider("X", "file:///etc", "")).toThrow("http(s) URL");
  });
});
