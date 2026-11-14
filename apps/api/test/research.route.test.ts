import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { createAgentRegistry } from "../src/agents/index.js";
import type { Agent } from "../src/agents/base/agent.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

const failingAgent: Agent = {
  id: "failing-agent",
  name: "Failing Agent",
  description: "Always fails, used to exercise the error path.",
  capabilities: [],
  async run() {
    const now = new Date().toISOString();

    return {
      agentId: "failing-agent",
      status: "failed",
      error: { code: "BOOM", message: "boom" },
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    };
  },
};

describe("TaskFleet API", () => {
  let db: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createTestDatabase();
    app = buildApp({
      logger: false,
      config: db.config,
      agents: createAgentRegistry(db.config.llm).register(failingAgent),
    });

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

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("lists registered agents", async () => {
    const response = await app.inject({ method: "GET", url: "/agents" });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.agents).toContainEqual(
      expect.objectContaining({
        id: "research-agent",
        capabilities: ["research", "summarization", "analysis"],
      })
    );
  });

  it("runs the research endpoint synchronously", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/research",
      payload: { input: "hello" },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toMatchObject({
      success: true,
      agentId: "research-agent",
      result: {
        agentId: "research-agent",
        status: "completed",
        provider: "stub",
        output: { topic: "hello" },
      },
    });
    expect(body.taskId).toEqual(expect.any(String));
    expect(body.runId).toEqual(expect.any(String));
  });

  it("rejects a blank research input with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/research",
      payload: { input: "   " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      issues: [{ path: "input" }],
    });
  });

  it("returns 404 for an unknown agent", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/research",
      payload: { input: "hello", agentId: "does-not-exist" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: "Unknown agent: does-not-exist",
    });
  });

  it("surfaces a failed agent result as 500", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/research",
      payload: { input: "hello", agentId: "failing-agent" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      error: "boom",
      result: { status: "failed", error: { code: "BOOM" } },
    });
  });

  it("creates a task asynchronously and persists progress events", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "Add rate limiting to the auth endpoint" },
    });

    expect(created.statusCode).toBe(202);

    const createdBody = created.json();
    expect(createdBody.task).toMatchObject({
      title: "Add rate limiting to the auth endpoint",
      agentId: "research-agent",
      status: "running",
    });
    expect(createdBody.run.id).toEqual(expect.any(String));

    const run = await waitForRun(createdBody.run.id);

    expect(run.status).toBe("completed");
    expect(run.provider).toBe("stub");
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(run.events.map((event: { type: string }) => event.type)).toEqual([
      "run.started",
      "run.progress",
      "run.progress",
      "run.completed",
    ]);

    const progress = run.events.filter(
      (event: { type: string }) => event.type === "run.progress"
    );
    expect(progress.map((event: { percent: number }) => event.percent)).toEqual([
      20, 80,
    ]);

    const task = await app.inject({
      method: "GET",
      url: `/tasks/${createdBody.task.id}`,
    });

    expect(task.statusCode).toBe(200);

    const taskBody = task.json();
    expect(taskBody.success).toBe(true);
    expect(taskBody.task).toMatchObject({
      id: createdBody.task.id,
      status: "completed",
    });
    expect(taskBody.task.runs[0].status).toBe("completed");
    expect(taskBody.task.runs[0].events[0].type).toBe("run.started");

    const list = await app.inject({ method: "GET", url: "/tasks" });
    expect(list.statusCode).toBe(200);
    expect(
      list
        .json()
        .tasks.some((item: { id: string }) => item.id === createdBody.task.id)
    ).toBe(true);
  });

  it("records a failed background run", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "Trigger the failure", agentId: "failing-agent" },
    });

    expect(created.statusCode).toBe(202);

    const run = await waitForRun(created.json().run.id);

    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("BOOM");
    expect(run.events.at(-1)).toMatchObject({
      type: "run.failed",
      percent: 100,
    });
  });

  it("returns 404 for unknown tasks and runs", async () => {
    const task = await app.inject({
      method: "GET",
      url: "/tasks/missing",
    });
    const run = await app.inject({
      method: "GET",
      url: "/runs/missing",
    });
    const events = await app.inject({
      method: "GET",
      url: "/runs/missing/events",
    });

    expect(task.statusCode).toBe(404);
    expect(run.statusCode).toBe(404);
    expect(events.statusCode).toBe(404);
  });
});
