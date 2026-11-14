import type {
  ActivityResponse,
  AgentResponse,
  AgentsResponse,
  CreateTaskResponse,
  DeleteResponse,
  HealthResponse,
  IntegrationsResponse,
  RunResponse,
  RunsResponse,
  ScanResponse,
  SecurityToolsResponse,
  StatsResponse,
  TaskListResponse,
  TaskPriority,
  TaskResponse,
  TaskStatus,
  WorktreesResponse,
} from "./types";

const RAW_BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

/** Base URL is configurable through VITE_API_URL and defaults to the /api proxy. */
export const API_BASE = RAW_BASE || "/api";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];

  constructor(message: string, status: number, issues: ApiIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(options.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: unknown = null;

    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      const record = isRecord(body) ? body : null;
      const message =
        record && typeof record.error === "string"
          ? record.error
          : `Request failed with status ${response.status}`;
      const issues =
        record && Array.isArray(record.issues)
          ? (record.issues as ApiIssue[]).filter(
              (issue): issue is ApiIssue =>
                isRecord(issue) &&
                typeof issue.path === "string" &&
                typeof issue.message === "string"
            )
          : [];

      throw new ApiError(message, response.status, issues);
    }

    return body as T;
  } catch (cause: unknown) {
    if (cause instanceof ApiError) {
      throw cause;
    }

    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new ApiError(
        `The API did not respond within ${
          (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000
        }s.`,
        0
      );
    }

    throw new ApiError(
      cause instanceof Error
        ? `Cannot reach the API at ${API_BASE}. ${cause.message}`
        : "Cannot reach the API.",
      0
    );
  } finally {
    clearTimeout(timeout);
  }
}

function queryString(
  params: Record<string, string | number | undefined>
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }

  const result = search.toString();

  return result ? `?${result}` : "";
}

export interface CreateTaskInput {
  title?: string;
  prompt: string;
  agentId: string;
  priority: TaskPriority;
  start: boolean;
}

export interface UpdateTaskInput {
  title?: string;
  prompt?: string;
  agentId?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
}

export interface ListRunsParams {
  status?: string;
  agentId?: string;
  taskId?: string;
  limit?: number;
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  stats: () => request<StatsResponse>("/stats"),

  activity: (limit = 20) =>
    request<ActivityResponse>(`/activity${queryString({ limit })}`),

  integrations: () => request<IntegrationsResponse>("/integrations"),

  tasks: {
    list: () => request<TaskListResponse>("/tasks"),

    get: (taskId: string) =>
      request<TaskResponse>(`/tasks/${encodeURIComponent(taskId)}`),

    create: (input: CreateTaskInput) =>
      request<CreateTaskResponse>("/tasks", { method: "POST", body: input }),

    update: (taskId: string, input: UpdateTaskInput) =>
      request<TaskResponse>(`/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: input,
      }),

    remove: (taskId: string) =>
      request<DeleteResponse>(`/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      }),

    run: (taskId: string) =>
      request<CreateTaskResponse>(`/tasks/${encodeURIComponent(taskId)}/run`, {
        method: "POST",
      }),
  },

  runs: {
    list: (params: ListRunsParams = {}) =>
      request<RunsResponse>(`/runs${queryString({ ...params })}`),

    get: (runId: string) =>
      request<RunResponse>(`/runs/${encodeURIComponent(runId)}`),
  },

  agents: {
    list: () => request<AgentsResponse>("/agents"),

    get: (agentId: string) =>
      request<AgentResponse>(`/agents/${encodeURIComponent(agentId)}`),
  },

  security: {
    tools: () => request<SecurityToolsResponse>("/security/tools"),

    scan: (path?: string) =>
      request<ScanResponse>("/security/scan", {
        method: "POST",
        body: path ? { path } : {},
        timeoutMs: 180_000,
      }),
  },

  worktrees: {
    list: () => request<WorktreesResponse>("/worktrees"),
  },
};

/** Absolute or proxy-relative URL for the per-run SSE stream. */
export function runEventsUrl(runId: string): string {
  return `${API_BASE}/runs/${encodeURIComponent(runId)}/events`;
}

export function githubWebhookUrl(): string {
  const root = API_BASE.endsWith("/api") ? API_BASE.slice(0, -4) : API_BASE;

  return `${root}/webhooks/github`;
}
