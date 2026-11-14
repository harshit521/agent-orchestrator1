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

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

const messagesResponseSchema = z.object({
  model: z.string().optional(),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.unknown().optional(),
    })
  ),
  stop_reason: z.string().nullable().optional(),
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
      ...(request.signal ? { signal: request.signal } : {}),
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

  async chatWithTools(request: LLMToolRequest): Promise<LLMToolResponse> {
    const model = this.defaultModel;
    const messages: Array<Record<string, unknown>> = [];

    for (const message of request.messages) {
      if (message.role === "tool") {
        const block = {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        };
        const previous = messages.at(-1);

        if (
          previous?.role === "user" &&
          Array.isArray(previous.content) &&
          (previous.content as Array<Record<string, unknown>>).every(
            (entry) => entry.type === "tool_result"
          )
        ) {
          (previous.content as Array<Record<string, unknown>>).push(block);
        } else {
          messages.push({ role: "user", content: [block] });
        }
      } else if (message.role === "assistant") {
        messages.push({
          role: "assistant",
          content: [
            ...(message.content
              ? [{ type: "text", text: message.content }]
              : []),
            ...(message.toolCalls ?? []).map((call) => ({
              type: "tool_use",
              id: call.id,
              name: call.name,
              input: parseArguments(call.arguments),
            })),
          ],
        });
      } else {
        messages.push({ role: "user", content: message.content });
      }
    }

    const json = await postJson(
      `${this.#baseUrl}/v1/messages`,
      {
        model,
        max_tokens: request.maxTokens ?? this.#maxTokens,
        ...(request.system ? { system: request.system } : {}),
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        messages,
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      },
      {
        headers: {
          "x-api-key": this.#apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        timeoutMs: this.#timeoutMs,
        retries: 2,
        ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      }
    );

    const parsed = messagesResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new LLMError(
        `Unexpected Anthropic response shape: ${
          parsed.error.issues[0]?.message ?? "unknown"
        }`,
        "LLM_INVALID_RESPONSE"
      );
    }

    const text = parsed.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    const toolCalls: LLMToolCall[] = parsed.data.content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: block.id ?? `tool-${block.name ?? "unknown"}`,
        name: block.name ?? "unknown",
        arguments: JSON.stringify(block.input ?? {}),
      }));

    if (!text && toolCalls.length === 0) {
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
      toolCalls,
      provider: this.id,
      model: parsed.data.model ?? model,
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
      ...(parsed.data.stop_reason
        ? { finishReason: parsed.data.stop_reason }
        : {}),
    };
  }
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
