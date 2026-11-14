import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

describe("Task CRUD and dashboard endpoints", () => {
  let db: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createTestDatabase();
    app = buildApp({ logger: false, config: db.config });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.cleanup();
  });

  async function waitForRun(runId: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/runs/${runId}`,
      });
      const body = response.json();

      if (body.run?.status === "completed" || body.run?.status === "failed") {
        return body.run;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Run ${runId} did not finish in time`);
  }

  it("creates a queued task without starting a run", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Queued task",
        prompt: "Draft a migration plan",
        priority: "high",
        start: false,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      success: true,
      run: null,
      task: {
        title: "Queued task",
        status: "queued",
        priority: "high",
        agentId: "research-agent",
      },
    });
    expect(response.json().task.runs).toEqual([]);
  });

  it("updates a task and persists the changes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "Editable task", start: false },
    });
    const taskId = created.json().task.id as string;

    const updated = await app.inject({
      method: "PATCH",
      url: `/tasks/${taskId}`,
      payload: {
        title: "Renamed task",
        priority: "urgent",
        status: "in_review",
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().task).toMatchObject({
      id: taskId,
      title: "Renamed task",
      priority: "urgent",
      status: "in_review",
    });

    const fetched = await app.inject({
      method: "GET",
      url: `/tasks/${taskId}`,
    });

    expect(fetched.json().task).toMatchObject({
      title: "Renamed task",
      priority: "urgent",
      status: "in_review",
    });
  });

  it("rejects invalid updates", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "Validation task", start: false },
    });
    const taskId = created.json().task.id as string;

    const empty = await app.inject({
      method: "PATCH",
      url: `/tasks/${taskId}`,
      payload: {},
    });
    const badPriority = await app.inject({
      method: "PATCH",
      url: `/tasks/${taskId}`,
      payload: { priority: "sometime" },
    });
    const unknownAgent = await app.inject({
      method: "PATCH",
      url: `/tasks/${taskId}`,
      payload: { agentId: "ghost-agent" },
    });
    const blankPrompt = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "   " },
    });

    expect(empty.statusCode).toBe(400);
    expect(badPriority.statusCode).toBe(400);
    expect(unknownAgent.statusCode).toBe(404);
    expect(blankPrompt.statusCode).toBe(400);
  });

  it("executes an existing task and exposes run history and statistics", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Execution task",
        prompt: "Summarize the orchestration flow",
        priority: "medium",
        start: false,
      },
    });
    const taskId = created.json().task.id as string;

    const started = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/run`,
    });

    expect(started.statusCode).toBe(202);
    const runId = started.json().run.id as string;

    const run = await waitForRun(runId);

    expect(run.status).toBe("completed");
    expect(run.task).toMatchObject({ id: taskId, title: "Execution task" });
    expect(run.provider).toBe("stub");
    expect(run.events.at(-1)).toMatchObject({
      type: "run.completed",
      percent: 100,
    });
    expect(run.events[1]).toMatchObject({ type: "agent.started" });

    const task = await app.inject({
      method: "GET",
      url: `/tasks/${taskId}`,
    });

    expect(task.json().task.status).toBe("completed");
    expect(task.json().task.runs).toHaveLength(1);

    const filtered = await app.inject({
      method: "GET",
      url: `/runs?taskId=${taskId}`,
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().runs).toHaveLength(1);
    expect(filtered.json().runs[0]).toMatchObject({
      id: runId,
      task: { id: taskId },
    });

    const stats = await app.inject({ method: "GET", url: "/stats" });

    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      success: true,
      agents: { total: expect.any(Number) },
    });
    expect(stats.json().agents.total).toBeGreaterThanOrEqual(1);
    expect(stats.json().tasks.total).toBeGreaterThanOrEqual(1);
    expect(stats.json().runs.total).toBeGreaterThanOrEqual(1);
    expect(stats.json().runs.completed).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(stats.json().recentActivity)).toBe(true);
    expect(stats.json().recentActivity.length).toBeGreaterThan(0);

    const activity = await app.inject({
      method: "GET",
      url: "/activity?limit=5",
    });

    expect(activity.statusCode).toBe(200);
    expect(activity.json().activity.length).toBeLessThanOrEqual(5);
    expect(activity.json().activity[0]).toMatchObject({
      taskId,
      runId,
    });

    const agents = await app.inject({ method: "GET", url: "/agents" });

    expect(agents.json().agents[0]).toMatchObject({
      id: "research-agent",
      provider: "stub",
      model: "stub-research-v1",
      status: "idle",
      stats: {
        totalRuns: 1,
        completedRuns: 1,
        failedRuns: 0,
      },
    });

    const agent = await app.inject({
      method: "GET",
      url: "/agents/research-agent",
    });

    expect(agent.statusCode).toBe(200);
    expect(agent.json().agent.stats.totalRuns).toBe(1);
    expect(agent.json().recentRuns).toHaveLength(1);

    const integrations = await app.inject({
      method: "GET",
      url: "/integrations",
    });

    expect(integrations.statusCode).toBe(200);
    expect(integrations.json()).toMatchObject({
      success: true,
      llm: { provider: "stub", configured: true },
      github: {
        repository: null,
        tokenConfigured: false,
        webhookConfigured: false,
      },
      worktrees: { enabled: false },
      security: { enabled: false },
    });
  });

  it("deletes a task and cascades its runs", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "Delete me", start: false },
    });
    const taskId = created.json().task.id as string;

    const started = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/run`,
    });
    const runId = started.json().run.id as string;
    await waitForRun(runId);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/tasks/${taskId}`,
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ success: true });

    const task = await app.inject({
      method: "GET",
      url: `/tasks/${taskId}`,
    });
    const run = await app.inject({
      method: "GET",
      url: `/runs/${runId}`,
    });

    expect(task.statusCode).toBe(404);
    expect(run.statusCode).toBe(404);

    const missing = await app.inject({
      method: "DELETE",
      url: `/tasks/${taskId}`,
    });

    expect(missing.statusCode).toBe(404);
  });

  it("returns 404 when running a missing task", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks/missing/run",
    });

    expect(response.statusCode).toBe(404);
  });
});
