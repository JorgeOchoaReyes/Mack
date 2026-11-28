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
  /** The reply stopped at `maxTokens` (finish reason "length"), not where the model chose to end it. */
  truncated?: boolean;
  /** The model's thinking, when the provider returns it apart from the answer (`reasoning` or `reasoning_content`). */
  reasoning?: string;
  /** The model the provider says answered (its `model` field), which a router may set to another version than the one asked for. */
  servedModel?: string;
  /** Thinking tokens the provider counted (`completion_tokens_details.reasoning_tokens`), part of the completion tokens. */
  reasoningTokens?: number;
};

export interface ModelProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<string[]>;
}

/** A thinking level for proof work: one the model is asked for, or "default" (send none, the model's own). */
export type ProofEffort = ReasoningEffort | "default";
export const PROOF_EFFORTS: ProofEffort[] = ["default", "off", "low", "medium", "high", "xhigh"];
export const EFFORT_LABELS: Record<ProofEffort, string> = { default: "Model default", off: "Off", on: "On", low: "Low", medium: "Medium", high: "High", xhigh: "Highest" };

/** `p` with every request that names no thinking level asking for `effort`; `p` itself for "default". */
export function withEffort(p: ModelProvider, effort: ProofEffort | undefined): ModelProvider {
  if (!effort || effort === "default") return p;
  return { name: p.name, listModels: () => p.listModels(), chat: (r: ChatRequest) => p.chat(r.reasoningEffort ? r : { ...r, reasoningEffort: effort }) };
}
