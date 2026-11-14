export type LLMRole = "user" | "assistant";

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMRequest {
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as returned by the provider. */
  arguments: string;
}

export type LLMToolMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LLMToolCall[] }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
      isError?: boolean;
    };

export interface LLMToolRequest {
  system?: string;
  messages: LLMToolMessage[];
  tools: LLMToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LLMToolResponse {
  text: string;
  toolCalls: LLMToolCall[];
  provider: string;
  model: string;
  usage?: LLMUsage;
  finishReason?: string;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMResponse {
  text: string;
  provider: string;
  model: string;
  usage?: LLMUsage;
}

export interface LLMProvider {
  readonly id: string;
  readonly defaultModel: string;

  complete(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Providers that can call structured tools implement this. The coding agent
   * refuses to run rather than silently falling back to text-only completion.
   */
  chatWithTools?(request: LLMToolRequest): Promise<LLMToolResponse>;
}

export function supportsToolCalling(
  provider: LLMProvider
): provider is LLMProvider & {
  chatWithTools(request: LLMToolRequest): Promise<LLMToolResponse>;
} {
  return typeof provider.chatWithTools === "function";
}

export interface LLMSettings {
  provider: "stub" | "openai" | "anthropic";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens: number;
  timeoutMs: number;
}

export class LLMError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.status = status;
  }
}
