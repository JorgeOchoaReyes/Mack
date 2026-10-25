// Fireworks AI through its OpenAI-compatible endpoint
// (https://api.fireworks.ai/inference/v1).

import { OpenAICompatibleProvider } from "./openai-compatible";

export const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

export class FireworksProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, baseUrl: string = FIREWORKS_BASE_URL) {
    if (!apiKey) throw new Error("no Fireworks API key is set");
    super("Fireworks", baseUrl, apiKey);
  }
}
