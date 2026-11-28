// Any OpenAI-compatible chat endpoint (`POST {base}/chat/completions`,
// `GET {base}/models`): Fireworks, OpenRouter, a LiteLLM proxy, and local
// servers such as Ollama, LM Studio or vLLM. Model ids are settings, never hard-coded here.
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
  /** Where `listPrices` reads: `pricing` on `/models` (OpenRouter), or LiteLLM's `/model/info`. */
  prices?: "models" | "litellm";
  /** A streamed reply that has begun (thinking or answer) and then sends nothing new for this long has stalled: it is given up (3 minutes by default). Before it begins, only `callTimeoutMs` holds it, since some models think without streaming their thinking. */
  idleTimeoutMs?: number;
  /** The most one call may take, start to finish (20 minutes by default): a reply slower than that is given up. */
  callTimeoutMs?: number;
};

/** A call given up for taking too long. It is not made again: it has already used its time. */
export class TimeoutError extends Error {}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Token counts as OpenAI-compatible APIs give them; thinking tokens are counted inside the completion tokens. */
type Usage = { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number | null } | null };
const thinkingTokens = (u?: Usage): number | undefined => (typeof u?.completion_tokens_details?.reasoning_tokens === "number" ? u.completion_tokens_details.reasoning_tokens : undefined);

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
    this.opts = { extraHeaders: o.extraHeaders ?? {}, reasoning: o.reasoning ?? "openai", retries: o.retries ?? 2, backoffMs: o.backoffMs ?? 1500, prices: o.prices ?? "models", idleTimeoutMs: o.idleTimeoutMs ?? 3 * 60_000, callTimeoutMs: o.callTimeoutMs ?? 20 * 60_000 };
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
    // A reply that stalls, or crawls past the limit, is given up instead of holding its caller forever.
    const ctl = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, ctl.signal]) : ctl.signal;
    const callMs = this.opts.callTimeoutMs;
    const whole = setTimeout(() => ctl.abort(new TimeoutError(`${this.name} gave no complete reply within ${Math.round(callMs / 60_000)} min`)), callMs);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const alive = () => {
      clearTimeout(idle);
      const ms = this.opts.idleTimeoutMs;
      idle = setTimeout(() => ctl.abort(new TimeoutError(`${this.name}'s reply stalled: nothing for ${Math.round(ms / 1000)}s`)), ms);
    };
    try {
      return await this.request(request, signal, markStreamed, alive);
    } catch (e) {
      // Our own limit, not the caller's stop: say which.
      if (ctl.signal.aborted && !request.signal?.aborted) throw ctl.signal.reason;
      throw e;
    } finally {
      clearTimeout(whole);
      clearTimeout(idle);
    }
  }

  private async request(request: ChatRequest, signal: AbortSignal, markStreamed: () => void, alive: () => void): Promise<ChatResponse> {
    const res = await fetch(this.url("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(request)),
      signal,
    });
    if (!res.ok) throw new HttpError(`${this.name} returned ${res.status}: ${(await res.text()).slice(0, 500)}`, res.status);
    if (request.onDelta && (res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
      return this.readStream(res.body, request.onDelta, markStreamed, alive);
    }
    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[];
      usage?: Usage;
      error?: { message?: string };
    };
    if (json.error) throw new Error(`${this.name}: ${json.error.message ?? "error"}`);
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${this.name} returned no message content`);
    request.onDelta?.(content);
    const thinking = json.choices?.[0]?.message?.reasoning ?? json.choices?.[0]?.message?.reasoning_content;
    return {
      content,
      ...(thinking ? { reasoning: thinking } : {}),
      usage: json.usage && { promptTokens: json.usage.prompt_tokens ?? 0, completionTokens: json.usage.completion_tokens ?? 0 },
      ...(json.choices?.[0]?.finish_reason === "length" ? { truncated: true } : {}),
      ...(json.model ? { servedModel: json.model } : {}),
      ...(thinkingTokens(json.usage) !== undefined ? { reasoningTokens: thinkingTokens(json.usage) } : {}),
    };
  }

  /** Server-sent events: `data: {choices:[{delta:{content}}]}` lines until `data: [DONE]`. */
  private async readStream(body: ReadableStream<Uint8Array>, onDelta: (t: string) => void, markStreamed: () => void, alive: () => void): Promise<ChatResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: ChatResponse["usage"];
    let truncated = false;
    let reasoning = "";
    let servedModel = "";
    let reasoningTokens: number | undefined;
    const handle = (line: string) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let j: { model?: string; choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[]; usage?: Usage; error?: { message?: string } };
      try {
        j = JSON.parse(data);
      } catch {
        return;
      }
      if (j.error) throw new Error(`${this.name}: ${j.error.message ?? "error"}`);
      const thought = j.choices?.[0]?.delta?.reasoning ?? j.choices?.[0]?.delta?.reasoning_content;
      if (thought || j.choices?.[0]?.delta?.content) alive();
      if (thought) {
        reasoning += thought;
        // Thinking already paid for: the call is not made again if it then stalls.
        markStreamed();
      }
      const piece = j.choices?.[0]?.delta?.content;
      if (piece) {
        content += piece;
        markStreamed();
        onDelta(piece);
      }
      if (j.choices?.[0]?.finish_reason === "length") truncated = true;
      if (j.model) servedModel = j.model;
      if (j.usage) {
        usage = { promptTokens: j.usage.prompt_tokens ?? 0, completionTokens: j.usage.completion_tokens ?? 0 };
        reasoningTokens = thinkingTokens(j.usage) ?? reasoningTokens;
      }
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
    return { content, usage, ...(truncated ? { truncated } : {}), ...(reasoning ? { reasoning } : {}), ...(servedModel ? { servedModel } : {}), ...(reasoningTokens !== undefined ? { reasoningTokens } : {}) };
  }

  /** Prices the catalogue publishes, USD per million tokens (OpenRouter and LiteLLM give them per token, Cheaper Inference per million); empty when it gives none. */
  async listPrices(): Promise<Record<string, { input: number; output: number }>> {
    if (this.opts.prices === "litellm") return this.litellmPrices();
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) return {};
    type Pricing = { prompt?: string | number; completion?: string | number; input_per_million?: string | number; output_per_million?: string | number };
    const json = (await res.json()) as { data?: { id?: string; pricing?: Pricing }[] };
    const out: Record<string, { input: number; output: number }> = {};
    for (const m of json.data ?? []) {
      const perMillion = m.pricing?.input_per_million !== undefined;
      const input = Number(perMillion ? m.pricing?.input_per_million : m.pricing?.prompt) * (perMillion ? 1 : 1_000_000);
      const output = Number(perMillion ? m.pricing?.output_per_million : m.pricing?.completion) * (perMillion ? 1 : 1_000_000);
      if (m.id && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) out[m.id] = { input, output };
    }
    return out;
  }

  /** LiteLLM's `/model/info`: each deployment's cost per token; the first priced deployment of a model name wins. */
  private async litellmPrices(): Promise<Record<string, { input: number; output: number }>> {
    const res = await fetch(this.url("/model/info"), { headers: this.headers() });
    if (!res.ok) return {};
    const json = (await res.json()) as { data?: { model_name?: string; model_info?: { input_cost_per_token?: number | null; output_cost_per_token?: number | null } }[] };
    const out: Record<string, { input: number; output: number }> = {};
    for (const d of json.data ?? []) {
      const input = d.model_info?.input_cost_per_token;
      const output = d.model_info?.output_cost_per_token;
      if (d.model_name && !out[d.model_name] && typeof input === "number" && typeof output === "number" && input >= 0 && output >= 0) {
        out[d.model_name] = { input: input * 1_000_000, output: output * 1_000_000 };
      }
    }
    return out;
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) throw new Error(`${this.name} returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    // A catalogue that also lists image, audio or video models marks each with its `type`; only chat models are offered.
    const json = (await res.json()) as { data?: { id?: string; type?: string }[] };
    return (json.data ?? [])
      .filter((m) => m.type === undefined || m.type === "text")
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string")
      .sort();
  }
}
