import type {
  AgentsResponse,
  CreateTaskResponse,
  TaskListResponse,
  TaskResponse,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return body as T;
}

export function listAgents(): Promise<AgentsResponse> {
  return request<AgentsResponse>("/agents");
}

export function listTasks(): Promise<TaskListResponse> {
  return request<TaskListResponse>("/tasks");
}

export function getTask(taskId: string): Promise<TaskResponse> {
  return request<TaskResponse>(`/tasks/${taskId}`);
}

export function createTask(
  prompt: string,
  agentId: string
): Promise<CreateTaskResponse> {
  return request<CreateTaskResponse>("/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, agentId }),
  });
}

export function runEventStreamUrl(runId: string): string {
  return `${API_BASE}/runs/${runId}/events`;
}
