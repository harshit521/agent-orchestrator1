import { z } from "zod";

const booleanFromEnv = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_URL: z.string().min(1).default("file:./data/taskfleet.db"),

  LLM_PROVIDER: z.enum(["stub", "openai", "anthropic"]).default("stub"),
  LLM_API_KEY: optionalString,
  LLM_MODEL: optionalString,
  LLM_BASE_URL: optionalUrl,
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  GITHUB_TOKEN: optionalString,
  GITHUB_REPOSITORY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/, "Expected owner/repository")
      .optional()
  ),
  GITHUB_WEBHOOK_SECRET: optionalString,

  WORKTREES_ENABLED: booleanFromEnv,
  WORKTREES_ROOT: optionalString,

  SECURITY_ENABLED: booleanFromEnv,
});

export interface LLMConfig {
  provider: "stub" | "openai" | "anthropic";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl: string;
  llm: LLMConfig;
  github: {
    token?: string;
    repository?: string;
    webhookSecret?: string;
  };
  worktrees: {
    enabled: boolean;
    root?: string;
  };
  security: {
    enabled: boolean;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");

    throw new ConfigError(`Invalid environment configuration: ${details}`);
  }

  const data = parsed.data;

  if (data.LLM_PROVIDER !== "stub" && !data.LLM_API_KEY) {
    throw new ConfigError(
      `LLM_API_KEY is required when LLM_PROVIDER=${data.LLM_PROVIDER}.`
    );
  }

  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    host: data.HOST,
    databaseUrl: data.DATABASE_URL,
    llm: {
      provider: data.LLM_PROVIDER,
      ...(data.LLM_API_KEY ? { apiKey: data.LLM_API_KEY } : {}),
      ...(data.LLM_MODEL ? { model: data.LLM_MODEL } : {}),
      ...(data.LLM_BASE_URL ? { baseUrl: data.LLM_BASE_URL } : {}),
      maxTokens: data.LLM_MAX_TOKENS,
      timeoutMs: data.LLM_TIMEOUT_MS,
    },
    github: {
      ...(data.GITHUB_TOKEN ? { token: data.GITHUB_TOKEN } : {}),
      ...(data.GITHUB_REPOSITORY
        ? { repository: data.GITHUB_REPOSITORY }
        : {}),
      ...(data.GITHUB_WEBHOOK_SECRET
        ? { webhookSecret: data.GITHUB_WEBHOOK_SECRET }
        : {}),
    },
    worktrees: {
      enabled: data.WORKTREES_ENABLED,
      ...(data.WORKTREES_ROOT ? { root: data.WORKTREES_ROOT } : {}),
    },
    security: {
      enabled: data.SECURITY_ENABLED,
    },
  };
}
