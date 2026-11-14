import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { GitHubClient } from "../src/github/client.js";
import { signPayload, verifySignature } from "../src/github/signature.js";
import { handleGithubWebhook, type WebhookStore } from "../src/github/webhook.js";
import { createTestDatabase, testConfig, type TestDatabase } from "./helpers.js";

const SECRET = "test-webhook-secret";

function pullRequestPayload(branch: string, action = "opened") {
  return {
    action,
    pull_request: {
      number: 42,
      merged: false,
      head: { ref: branch },
    },
  };
}

describe("GitHub integration", () => {
  describe("webhook signature", () => {
    it("accepts a valid signature and rejects tampering", () => {
      const payload = JSON.stringify({ hello: "world" });
      const signature = signPayload(SECRET, payload);

      expect(verifySignature(SECRET, payload, signature)).toBe(true);
      expect(verifySignature(SECRET, `${payload} `, signature)).toBe(false);
      expect(verifySignature("other", payload, signature)).toBe(false);
      expect(verifySignature(SECRET, payload, undefined)).toBe(false);
    });
  });

  describe("webhook handler", () => {
    it("maps a PR branch to the task and updates its status", async () => {
      const updates: Array<[string, string]> = [];
      const store: WebhookStore = {
        async getTask(taskId) {
          return taskId === "task-1" ? { id: taskId } : null;
        },
        async updateTaskStatus(taskId, status) {
          updates.push([taskId, status]);
        },
      };

      const result = await handleGithubWebhook(
        "pull_request",
        pullRequestPayload("taskfleet/task-1"),
        store
      );

      expect(result).toEqual({
        handled: true,
        taskId: "task-1",
        status: "in_review",
      });
      expect(updates).toEqual([["task-1", "in_review"]]);
    });

    it("marks failed CI as needing attention", async () => {
      const store: WebhookStore = {
        async getTask(taskId) {
          return { id: taskId };
        },
        async updateTaskStatus() {
          return undefined;
        },
      };

      const result = await handleGithubWebhook(
        "check_suite",
        {
          check_suite: {
            head_branch: "taskfleet/task-2",
            conclusion: "failure",
          },
        },
        store
      );

      expect(result).toMatchObject({
        handled: true,
        taskId: "task-2",
        status: "failed",
      });
    });

    it("ignores branches that are not taskfleet branches", async () => {
      const store: WebhookStore = {
        async getTask() {
          return null;
        },
        async updateTaskStatus() {
          return undefined;
        },
      };

      const result = await handleGithubWebhook(
        "pull_request",
        pullRequestPayload("feature/other"),
        store
      );

      expect(result.handled).toBe(false);
    });
  });

  describe("pull request client", () => {
    it("creates a PR through the GitHub REST API", async () => {
      let capturedUrl: string | undefined;
      let capturedBody: unknown;

      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));

        return new Response(
          JSON.stringify({
            number: 7,
            html_url: "https://github.com/acme/repo/pull/7",
            state: "open",
            title: "TaskFleet: task-1",
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const client = new GitHubClient({
        token: "token",
        repository: "acme/repo",
        fetchImpl,
      });

      const pullRequest = await client.createPullRequest({
        title: "TaskFleet: task-1",
        head: "taskfleet/task-1",
        base: "main",
      });

      expect(pullRequest).toEqual({
        number: 7,
        url: "https://github.com/acme/repo/pull/7",
        state: "open",
        title: "TaskFleet: task-1",
      });
      expect(capturedUrl).toBe(
        "https://api.github.com/repos/acme/repo/pulls"
      );
      expect(capturedBody).toMatchObject({
        head: "taskfleet/task-1",
        base: "main",
      });
    });
  });

  describe("webhook route", () => {
    let db: TestDatabase;
    let app: FastifyInstance;

    beforeAll(async () => {
      db = createTestDatabase();
      app = buildApp({
        logger: false,
        config: {
          ...testConfig(db.config.databaseUrl),
          github: { webhookSecret: SECRET },
        },
      });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      db.cleanup();
    });

    it("verifies the signature and updates the referenced task", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { prompt: "Open a PR for this task" },
      });
      const taskId = created.json().task.id as string;

      const raw = JSON.stringify(pullRequestPayload(`taskfleet/${taskId}`));

      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(SECRET, raw),
        },
        payload: raw,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        success: true,
        handled: true,
        taskId,
        status: "in_review",
      });

      const task = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}`,
      });

      expect(task.json().task.status).toBe("in_review");
    });

    it("rejects an invalid signature", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-hub-signature-256": "sha256=deadbeef",
        },
        payload: JSON.stringify(pullRequestPayload("taskfleet/task-1")),
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
