// Fireworks AI through its OpenAI-compatible endpoint
// (https://api.fireworks.ai/inference/v1). Model ids are settings, never
// hard-coded here: Fireworks' catalogue changes.

import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";

export const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

export class FireworksProvider implements ModelProvider {
  readonly name = "fireworks";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = FIREWORKS_BASE_URL,
  ) {
    if (!apiKey) throw new Error("no Fireworks API key is set");
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model: request.model, messages: request.messages };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!res.ok) throw new Error(`Fireworks returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Fireworks returned no message content");
    return {
      content,
      usage: json.usage && {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
      },
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Fireworks returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as { data?: { id?: string }[] };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string").sort();
  }
}
