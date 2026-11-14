import { taskIdFromBranch } from "../worktrees/worktree-service.js";

export interface WebhookStore {
  getTask(taskId: string): Promise<{ id: string } | null>;
  updateTaskStatus(taskId: string, status: string): Promise<unknown>;
  /** Resolves a per-run `taskfleet/<runId>` branch back to its task. */
  resolveTaskId?(taskfleetId: string): Promise<string | null>;
}

export interface WebhookResult {
  handled: boolean;
  taskId?: string;
  status?: string;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function readString(value: unknown, path: string[]): string | null {
  const result = readPath(value, path);

  return typeof result === "string" ? result : null;
}

/** Extracts the task id from a `taskfleet/<taskId>` branch. */
export function taskIdFromWebhook(
  event: string,
  payload: unknown
): string | null {
  const branch =
    event === "pull_request"
      ? readString(payload, ["pull_request", "head", "ref"])
      : event === "check_suite"
        ? readString(payload, ["check_suite", "head_branch"])
        : event === "check_run"
          ? readString(payload, ["check_run", "check_suite", "head_branch"])
          : event === "push"
            ? (readString(payload, ["ref"]) ?? "").replace(/^refs\/heads\//, "")
            : null;

  return branch ? taskIdFromBranch(branch) : null;
}

export function statusFromWebhook(
  event: string,
  payload: unknown
): string | null {
  if (event === "pull_request") {
    const action = readString(payload, ["action"]);
    const merged = readPath(payload, ["pull_request", "merged"]) === true;

    if (action === "closed") {
      return merged ? "ready_to_merge" : "failed";
    }

    if (action === "opened" || action === "reopened" || action === "synchronize") {
      return "in_review";
    }

    return null;
  }

  if (event === "check_suite" || event === "check_run") {
    const conclusion = readString(payload, [
      event,
      "conclusion",
    ]);

    if (conclusion === null) {
      return "running";
    }

    return conclusion === "success" ? "in_review" : "failed";
  }

  return null;
}

/**
 * Applies a GitHub webhook to the task referenced by the branch name.
 * Unknown events and branches are acknowledged but not handled.
 */
export async function handleGithubWebhook(
  event: string,
  payload: unknown,
  store: WebhookStore
): Promise<WebhookResult> {
  const taskId = taskIdFromWebhook(event, payload);

  if (!taskId) {
    return { handled: false, reason: "No taskfleet branch in payload." };
  }

  const status = statusFromWebhook(event, payload);

  if (!status) {
    return { handled: false, taskId, reason: `Unmapped ${event} action.` };
  }

  const task = await store.getTask(taskId);

  if (task) {
    await store.updateTaskStatus(task.id, status);
    return { handled: true, taskId: task.id, status };
  }

  if (store.resolveTaskId) {
    const resolvedTaskId = await store.resolveTaskId(taskId);

    if (resolvedTaskId) {
      await store.updateTaskStatus(resolvedTaskId, status);
      return { handled: true, taskId: resolvedTaskId, status };
    }
  }

  return { handled: false, taskId, reason: "Task not found." };
}
