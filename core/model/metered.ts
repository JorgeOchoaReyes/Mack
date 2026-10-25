// The spending cap: a provider wrapper that prices every model call of one
// session (a chat, a proof run, a search run, an Ultramath swarm) and refuses
// further calls once the session's spend reaches its limit.
//
// Cost is the provider's reported token counts times the model's price (USD
// per million tokens, from the provider's catalogue or entered in Setup).
// When a provider reports no usage, the tokens are estimated from the text
// (about four characters a token) and the meter says it estimated. A call
// already in flight when the limit is crossed finishes and is charged, so a
// session can overshoot its cap by at most the calls running at that moment;
// no call starts after the cap is reached.

import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";

export type Price = { input: number; output: number };

export type Meter = {
  /** USD spent so far in this session. */
  spent: number;
  /** USD this session may spend; 0 means no cap. */
  limit: number;
  /** Whether some call's tokens were estimated rather than reported. */
  estimated: boolean;
};

export class SpendCapReached extends Error {
  constructor(meter: Meter) {
    super(`the spending cap for this session ($${meter.limit.toFixed(2)}) is reached: $${meter.spent.toFixed(4)} spent`);
  }
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function callCost(price: Price, promptTokens: number, completionTokens: number): number {
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

/** `provider` with every call priced into `meter`; `onCharge` hears each charge, `onCap` when the cap stops a call. */
export function metered(provider: ModelProvider, price: Price | undefined, meter: Meter, hooks: { onCharge?: (m: Meter) => void; onCap?: () => void } = {}): ModelProvider {
  return {
    name: provider.name,
    listModels: () => provider.listModels(),
    chat: async (request: ChatRequest): Promise<ChatResponse> => {
      if (meter.limit > 0 && meter.spent >= meter.limit) {
        hooks.onCap?.();
        throw new SpendCapReached(meter);
      }
      const r = await provider.chat(request);
      if (price) {
        let usage = r.usage;
        if (!usage) {
          meter.estimated = true;
          usage = {
            promptTokens: estimateTokens(request.messages.map((m) => m.content).join("\n")) + (request.messages.flatMap((m) => m.images ?? []).length * 1000),
            completionTokens: estimateTokens(r.content),
          };
        }
        meter.spent += callCost(price, usage.promptTokens, usage.completionTokens);
        hooks.onCharge?.(meter);
      }
      return r;
    },
  };
}

export const formatUsd = (usd: number) => (usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
