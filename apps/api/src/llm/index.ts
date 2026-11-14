import { AnthropicProvider } from "./anthropic.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { StubProvider } from "./stub.provider.js";
import type { LLMProvider, LLMSettings } from "./types.js";

export function createLLMProvider(settings: LLMSettings): LLMProvider {
  const common = {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
    maxTokens: settings.maxTokens,
    timeoutMs: settings.timeoutMs,
  };

  switch (settings.provider) {
    case "openai":
      return new OpenAIProvider({
        apiKey: requireApiKey(settings),
        ...common,
      });
    case "anthropic":
      return new AnthropicProvider({
        apiKey: requireApiKey(settings),
        ...common,
      });
    case "stub":
      return new StubProvider();
  }
}

function requireApiKey(settings: LLMSettings): string {
  if (!settings.apiKey) {
    throw new Error(
      `LLM_API_KEY is required when LLM_PROVIDER=${settings.provider}.`
    );
  }

  return settings.apiKey;
}
