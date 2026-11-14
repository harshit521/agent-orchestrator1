import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { createAgentRegistry } from "../src/agents/index.js";
import type { Agent } from "../src/agents/base/agent.js";

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

describe("POST /research", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      logger: false,
      agents: createAgentRegistry().register(failingAgent),
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs the default agent for a valid request", async () => {
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
      result: { agentId: "research-agent", status: "completed" },
    });
    expect(body.taskId).toEqual(expect.any(String));
    expect(body.runId).toEqual(expect.any(String));
  });

  it("rejects a blank input with 400", async () => {
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

  it("rejects a missing input with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/research",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
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

  it("responds to health checks", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });
});
