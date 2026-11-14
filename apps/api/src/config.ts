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
  GITHUB_BASE_BRANCH: z.string().trim().min(1).default("main"),
  GITHUB_REMOTE_URL: optionalString,

  WORKTREES_ENABLED: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((value) => value === "true" || value === "1"),
  WORKTREES_ROOT: optionalString,
  WORKTREE_KEEP_ON_FAILURE: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((value) => value === "true" || value === "1"),
  WORKTREE_KEEP_ON_SUCCESS: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((value) => value === "true" || value === "1"),

  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(100).default(20),
  AGENT_MAX_TOKENS: z.coerce.number().int().positive().default(100_000),
  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(500).default(80),
  AGENT_COMMAND_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(120_000),
  AGENT_TEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(180_000),
  AGENT_RUN_TESTS: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((value) => value === "true" || value === "1"),
  AGENT_REQUIRE_CHANGES: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((value) => value === "true" || value === "1"),
  AGENT_TEST_COMMAND: optionalString,
  AGENT_COMMAND_ALLOWLIST: z
    .string()
    .trim()
    .default("npm,npx,node,pnpm,yarn,python,python3,pytest,go,cargo,make"),

  GIT_AUTHOR_NAME: z.string().trim().min(1).default("TaskFleet Agent"),
  GIT_AUTHOR_EMAIL: z
    .string()
    .trim()
    .email()
    .default("agent@taskfleet.local"),

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

export interface GitHubConfig {
  token?: string;
  repository?: string;
  webhookSecret?: string;
  baseBranch: string;
  remoteUrl?: string;
}

export interface WorktreeConfig {
  enabled: boolean;
  root?: string;
  keepOnFailure: boolean;
  keepOnSuccess: boolean;
}

export interface AgentConfig {
  maxSteps: number;
  maxTokens: number;
  maxToolCalls: number;
  commandTimeoutMs: number;
  testTimeoutMs: number;
  runTests: boolean;
  requireChanges: boolean;
  testCommand?: string;
  commandAllowlist: string[];
}

export interface GitConfig {
  authorName: string;
  authorEmail: string;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl: string;
  llm: LLMConfig;
  github: GitHubConfig;
  worktrees: WorktreeConfig;
  agent: AgentConfig;
  git: GitConfig;
  security: {
    enabled: boolean;
    policy: "fail-closed" | "warn-only"; // fail-closed blocks on blocking findings, warn-only reports warnings
    scanners?: string[]; // explicitly enabled scanners, defaults to all configured
    scanTimeoutMs: number;
  },
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
      baseBranch: data.GITHUB_BASE_BRANCH,
      ...(data.GITHUB_REMOTE_URL
        ? { remoteUrl: data.GITHUB_REMOTE_URL }
        : {}),
    },
    worktrees: {
      enabled: data.WORKTREES_ENABLED,
      ...(data.WORKTREES_ROOT ? { root: data.WORKTREES_ROOT } : {}),
      keepOnFailure: data.WORKTREE_KEEP_ON_FAILURE,
      keepOnSuccess: data.WORKTREE_KEEP_ON_SUCCESS,
    },
    agent: {
      maxSteps: data.AGENT_MAX_STEPS,
      maxTokens: data.AGENT_MAX_TOKENS,
      maxToolCalls: data.AGENT_MAX_TOOL_CALLS,
      commandTimeoutMs: data.AGENT_COMMAND_TIMEOUT_MS,
      testTimeoutMs: data.AGENT_TEST_TIMEOUT_MS,
      runTests: data.AGENT_RUN_TESTS,
      requireChanges: data.AGENT_REQUIRE_CHANGES,
      ...(data.AGENT_TEST_COMMAND
        ? { testCommand: data.AGENT_TEST_COMMAND }
        : {}),
      commandAllowlist: data.AGENT_COMMAND_ALLOWLIST.split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    },
    git: {
      authorName: data.GIT_AUTHOR_NAME,
      authorEmail: data.GIT_AUTHOR_EMAIL,
    },
    security: {
      enabled: data.SECURITY_ENABLED,
    },
  };
}
