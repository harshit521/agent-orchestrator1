import { z } from "zod";

import { postJson } from "./http.js";
import {
  LLMError,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMToolCall,
  type LLMToolRequest,
  type LLMToolResponse,
  type LLMUsage,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(toolCallSchema).optional(),
        }),
        finish_reason: z.string().nullable().optional(),
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
      ...(request.signal ? { signal: request.signal } : {}),
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

  /**
   * Native OpenAI function calling. The coding agent drives a multi-step loop
   * with these responses and sends tool results back as `role: "tool"`.
   */
  async chatWithTools(request: LLMToolRequest): Promise<LLMToolResponse> {
    const model = this.defaultModel;
    const messages: Array<Record<string, unknown>> = [];

    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }

    for (const message of request.messages) {
      if (message.role === "tool") {
        messages.push({
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        });
      } else if (message.role === "assistant") {
        messages.push({
          role: "assistant",
          content: message.content || null,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: call.arguments,
                  },
                })),
              }
            : {}),
        });
      } else {
        messages.push({ role: "user", content: message.content });
      }
    }

    const json = await postJson(
      `${this.#baseUrl}/chat/completions`,
      {
        model,
        messages,
        max_tokens: request.maxTokens ?? this.#maxTokens,
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: "auto",
      },
      {
        headers: { authorization: `Bearer ${this.#apiKey}` },
        timeoutMs: this.#timeoutMs,
        retries: 2,
        ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      }
    );

    const parsed = chatCompletionSchema.safeParse(json);

    if (!parsed.success) {
      throw new LLMError(
        `Unexpected OpenAI response shape: ${
          parsed.error.issues[0]?.message ?? "unknown"
        }`,
        "LLM_INVALID_RESPONSE"
      );
    }

    const choice = parsed.data.choices[0];

    if (!choice) {
      throw new LLMError(
        "OpenAI returned no choices",
        "LLM_EMPTY_RESPONSE"
      );
    }

    const text = choice.message.content?.trim() ?? "";

    const toolCalls: LLMToolCall[] = (choice.message.tool_calls ?? []).map(
      (call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      })
    );

    if (!text && toolCalls.length === 0) {
      throw new LLMError(
        "OpenAI returned an empty completion",
        "LLM_EMPTY_RESPONSE"
      );
    }

    const usage = usageFrom(parsed.data.usage);

    return {
      text,
      toolCalls,
      provider: this.id,
      model: parsed.data.model ?? model,
      ...(usage ? { usage } : {}),
      ...(choice.finish_reason ? { finishReason: choice.finish_reason } : {}),
    };
  }
}

function usageFrom(
  usage:
    | {
        prompt_tokens?: number | undefined;
        completion_tokens?: number | undefined;
      }
    | undefined
): LLMUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const result: LLMUsage = {
    ...(usage.prompt_tokens !== undefined
      ? { inputTokens: usage.prompt_tokens }
      : {}),
    ...(usage.completion_tokens !== undefined
      ? { outputTokens: usage.completion_tokens }
      : {}),
  };

  return Object.keys(result).length > 0 ? result : undefined;
}
