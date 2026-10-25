// Any OpenAI-compatible chat endpoint (`POST {base}/chat/completions`,
// `GET {base}/models`): Fireworks, OpenRouter, and local servers such as
// Ollama, LM Studio or vLLM. Model ids are settings, never hard-coded here.

import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";

export class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly extraHeaders: Record<string, string> = {},
  ) {
    if (!/^https?:\/\//.test(baseUrl)) throw new Error(`${name}: the endpoint must be an http(s) URL`);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", ...this.extraHeaders };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model: request.model, messages: request.messages };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    const res = await fetch(this.url("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!res.ok) throw new Error(`${this.name} returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (json.error) throw new Error(`${this.name}: ${json.error.message ?? "error"}`);
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${this.name} returned no message content`);
    return {
      content,
      usage: json.usage && {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
      },
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) throw new Error(`${this.name} returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as { data?: { id?: string }[] };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string").sort();
  }
}
