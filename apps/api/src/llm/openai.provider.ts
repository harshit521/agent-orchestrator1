import { z } from "zod";

import { postJson } from "./http.js";
import {
  LLMError,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMUsage,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Adapter for OpenAI's chat completions API. Because the wire format is
 * widely cloned, this also works with OpenAI-compatible gateways
 * (OpenRouter, Groq, vLLM, ...) via `baseUrl`.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = "openai";
  readonly defaultModel: string;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #maxTokens: number;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch | undefined;

  constructor(options: OpenAIProviderOptions) {
    this.#apiKey = options.apiKey;
    this.defaultModel = options.model ?? DEFAULT_MODEL;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#maxTokens = options.maxTokens ?? 1024;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#fetchImpl = options.fetchImpl;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = this.defaultModel;
    const messages = request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;

    const payload = {
      model,
      messages,
      max_tokens: request.maxTokens ?? this.#maxTokens,
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
    };

    const json = await postJson(`${this.#baseUrl}/chat/completions`, payload, {
      headers: { authorization: `Bearer ${this.#apiKey}` },
      timeoutMs: this.#timeoutMs,
      ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
    });

    const parsed = chatCompletionSchema.safeParse(json);

    if (!parsed.success) {
      throw new LLMError(
        `Unexpected OpenAI response shape: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        "LLM_INVALID_RESPONSE"
      );
    }

    const text = parsed.data.choices[0]?.message.content?.trim() ?? "";

    if (!text) {
      throw new LLMError(
        "OpenAI returned an empty completion",
        "LLM_EMPTY_RESPONSE"
      );
    }

    const usage: LLMUsage = {
      ...(parsed.data.usage?.prompt_tokens !== undefined
        ? { inputTokens: parsed.data.usage.prompt_tokens }
        : {}),
      ...(parsed.data.usage?.completion_tokens !== undefined
        ? { outputTokens: parsed.data.usage.completion_tokens }
        : {}),
    };

    return {
      text,
      provider: this.id,
      model: parsed.data.model ?? model,
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    };
  }
}
