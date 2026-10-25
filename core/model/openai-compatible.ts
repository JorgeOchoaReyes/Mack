// Any OpenAI-compatible chat endpoint (`POST {base}/chat/completions`,
// `GET {base}/models`): Fireworks, OpenRouter, and local servers such as
// Ollama, LM Studio or vLLM. Model ids are settings, never hard-coded here.
//
// Streams when the caller asks for pieces (`onDelta`), sends images as
// content parts, passes the reasoning effort in the dialect the provider
// reads, and makes a call that failed transiently (a refused connection, 429,
// 5xx) again, at most `retries` times, as upstream's chat agent does
// (`program-files/chat-agent/src/retry.rs`). A call that streamed part of an
// answer is not made again: its effect is uncertain.

import type { ChatMessage, ChatRequest, ChatResponse, ModelProvider } from "./provider";

export type ReasoningDialect = "openai" | "openrouter" | "none";

export type ProviderOptions = {
  extraHeaders?: Record<string, string>;
  reasoning?: ReasoningDialect;
  retries?: number;
  /** Milliseconds before the first retry; doubled each time. */
  backoffMs?: number;
};

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const transient = (e: unknown) => (e instanceof HttpError ? e.status === 429 || e.status >= 500 : e instanceof TypeError);

function wireMessage(m: ChatMessage): Record<string, unknown> {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [{ type: "text", text: m.content }, ...m.images.map((url) => ({ type: "image_url", image_url: { url } }))],
  };
}

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly opts: Required<ProviderOptions>;

  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    o: ProviderOptions = {},
  ) {
    if (!/^https?:\/\//.test(baseUrl)) throw new Error(`${name}: the endpoint must be an http(s) URL`);
    this.opts = { extraHeaders: o.extraHeaders ?? {}, reasoning: o.reasoning ?? "openai", retries: o.retries ?? 2, backoffMs: o.backoffMs ?? 1500 };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", ...this.opts.extraHeaders };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private body(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { model: request.model, messages: request.messages.map(wireMessage) };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    const effort = request.reasoningEffort;
    if (effort && effort !== "off" && this.opts.reasoning !== "none") {
      if (this.opts.reasoning === "openrouter") body.reasoning = effort === "on" ? { enabled: true } : { effort: effort === "xhigh" ? "high" : effort };
      else if (effort !== "on") body.reasoning_effort = effort === "xhigh" ? "high" : effort;
    }
    if (request.onDelta) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    for (let attempt = 0; ; attempt++) {
      let streamed = false;
      try {
        return await this.once(request, () => (streamed = true));
      } catch (e) {
        if (request.signal?.aborted || streamed || attempt >= this.opts.retries || !transient(e)) throw e;
        await new Promise((r) => setTimeout(r, this.opts.backoffMs * 2 ** attempt));
      }
    }
  }

  private async once(request: ChatRequest, markStreamed: () => void): Promise<ChatResponse> {
    const res = await fetch(this.url("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(request)),
      signal: request.signal,
    });
    if (!res.ok) throw new HttpError(`${this.name} returned ${res.status}: ${(await res.text()).slice(0, 500)}`, res.status);
    if (request.onDelta && (res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
      return this.readStream(res.body, request.onDelta, markStreamed);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (json.error) throw new Error(`${this.name}: ${json.error.message ?? "error"}`);
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${this.name} returned no message content`);
    request.onDelta?.(content);
    return {
      content,
      usage: json.usage && { promptTokens: json.usage.prompt_tokens ?? 0, completionTokens: json.usage.completion_tokens ?? 0 },
    };
  }

  /** Server-sent events: `data: {choices:[{delta:{content}}]}` lines until `data: [DONE]`. */
  private async readStream(body: ReadableStream<Uint8Array>, onDelta: (t: string) => void, markStreamed: () => void): Promise<ChatResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: ChatResponse["usage"];
    const handle = (line: string) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let j: { choices?: { delta?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
      try {
        j = JSON.parse(data);
      } catch {
        return;
      }
      if (j.error) throw new Error(`${this.name}: ${j.error.message ?? "error"}`);
      const piece = j.choices?.[0]?.delta?.content;
      if (piece) {
        content += piece;
        markStreamed();
        onDelta(piece);
      }
      if (j.usage) usage = { promptTokens: j.usage.prompt_tokens ?? 0, completionTokens: j.usage.completion_tokens ?? 0 };
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf("\n")) !== -1) {
        handle(buffer.slice(0, i).replace(/\r$/, ""));
        buffer = buffer.slice(i + 1);
      }
    }
    handle(buffer);
    return { content, usage };
  }

  /** Prices the catalogue publishes, USD per million tokens (OpenRouter gives them per token); empty when it gives none. */
  async listPrices(): Promise<Record<string, { input: number; output: number }>> {
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) return {};
    const json = (await res.json()) as { data?: { id?: string; pricing?: { prompt?: string | number; completion?: string | number } }[] };
    const out: Record<string, { input: number; output: number }> = {};
    for (const m of json.data ?? []) {
      const input = Number(m.pricing?.prompt);
      const output = Number(m.pricing?.completion);
      if (m.id && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) out[m.id] = { input: input * 1_000_000, output: output * 1_000_000 };
    }
    return out;
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) throw new Error(`${this.name} returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as { data?: { id?: string }[] };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string").sort();
  }
}
