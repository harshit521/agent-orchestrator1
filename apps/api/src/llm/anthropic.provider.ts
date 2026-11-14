import { z } from "zod";

import { postJson } from "./http.js";
import {
  LLMError,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMUsage,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

const messagesResponseSchema = z.object({
  model: z.string().optional(),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    })
  ),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Adapter for Anthropic's Messages API. */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly defaultModel: string;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #maxTokens: number;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch | undefined;

  constructor(options: AnthropicProviderOptions) {
    this.#apiKey = options.apiKey;
    this.defaultModel = options.model ?? DEFAULT_MODEL;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#maxTokens = options.maxTokens ?? 1024;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#fetchImpl = options.fetchImpl;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = this.defaultModel;
    const payload = {
      model,
      max_tokens: request.maxTokens ?? this.#maxTokens,
      ...(request.system ? { system: request.system } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      messages: request.messages,
    };

    const json = await postJson(`${this.#baseUrl}/v1/messages`, payload, {
      headers: {
        "x-api-key": this.#apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      timeoutMs: this.#timeoutMs,
      ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
    });

    const parsed = messagesResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new LLMError(
        `Unexpected Anthropic response shape: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        "LLM_INVALID_RESPONSE"
      );
    }

    const text = parsed.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new LLMError(
        "Anthropic returned an empty completion",
        "LLM_EMPTY_RESPONSE"
      );
    }

    const usage: LLMUsage = {
      ...(parsed.data.usage?.input_tokens !== undefined
        ? { inputTokens: parsed.data.usage.input_tokens }
        : {}),
      ...(parsed.data.usage?.output_tokens !== undefined
        ? { outputTokens: parsed.data.usage.output_tokens }
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
