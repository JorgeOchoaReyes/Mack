// The model interface every provider implements, so the prover never depends
// on one vendor. Providers receive the API key per call from the main
// process; it is never logged or stored in a transcript.

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Images that follow the text, as data URLs; sent only to models that take images. */
  images?: string[];
};

/** How deeply a reasoning model thinks; "on" enables reasoning without naming a depth (upstream's `EffortSetting`). */
export type ReasoningEffort = "off" | "on" | "low" | "medium" | "high" | "xhigh";

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  /** Called with each piece of the answer as it streams; the response still carries the whole answer. */
  onDelta?: (text: string) => void;
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
