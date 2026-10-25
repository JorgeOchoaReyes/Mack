// The model interface every provider implements, so the prover never depends
// on one vendor. Providers receive the API key per call from the main
// process; it is never logged or stored in a transcript.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type ChatResponse = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
};

export interface ModelProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<string[]>;
}
