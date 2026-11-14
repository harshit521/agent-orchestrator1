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
