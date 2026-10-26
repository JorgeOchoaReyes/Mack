// The model providers Mack can call, chosen per run. Each user brings their
// own key; Mack ships none. This file imports nothing from Node, so the
// renderer can show the same list.

export type ProviderId = "fireworks" | "openrouter" | "litellm" | "custom";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Fixed endpoint; otherwise the person sets it, in the setting `endpointSetting` names. */
  baseUrl?: string;
  endpointSetting?: "litellmBaseUrl" | "customBaseUrl";
  /** Where prices come from: a `pricing` field on `/models` (the default), or LiteLLM's `/model/info`. */
  prices?: "models" | "litellm";
  /** Read from the environment (or `.env`) before the key saved in the app. */
  keyEnv: string;
  keyRequired: boolean;
  keyPlaceholder: string;
  keyUrl?: string;
  modelPlaceholder: string;
  blurb: string;
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "fireworks",
    label: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    keyEnv: "FIREWORKS_API_KEY",
    keyRequired: true,
    keyPlaceholder: "fw_…",
    keyUrl: "https://app.fireworks.ai/settings/users/api-keys",
    modelPlaceholder: "accounts/fireworks/models/…",
    blurb: "Open models served by Fireworks AI.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    keyRequired: true,
    keyPlaceholder: "sk-or-…",
    keyUrl: "https://openrouter.ai/settings/keys",
    modelPlaceholder: "deepseek/deepseek-r1, qwen/…",
    blurb: "One key for models from many vendors (upstream's default provider).",
  },
  {
    id: "litellm",
    label: "LiteLLM",
    endpointSetting: "litellmBaseUrl",
    prices: "litellm",
    keyEnv: "LITELLM_API_KEY",
    keyRequired: false,
    keyPlaceholder: "sk-… master or virtual key (optional)",
    modelPlaceholder: "a model_name from your LiteLLM config",
    blurb: "A LiteLLM proxy: one endpoint for the models of many providers. Mack reads the prices you configured there.",
  },
  {
    id: "custom",
    label: "OpenAI-compatible",
    endpointSetting: "customBaseUrl",
    keyEnv: "CUSTOM_API_KEY",
    keyRequired: false,
    keyPlaceholder: "optional",
    modelPlaceholder: "the model id the server expects",
    blurb: "Any endpoint that speaks the OpenAI chat API: Ollama, LM Studio, vLLM, or a hosted service.",
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
