import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";

import { buildApp } from "../src/app.js";
import type { Agent } from "../src/agents/base/agent.js";
import type { AgentContext } from "../src/agents/base/agent-context.js";
import { AgentRegistry } from "../src/agents/registry.js";
import type { GitHubClient } from "../src/github/client.js";
import type { CreatePullRequestInput } from "../src/github/client.js";
import {
  createTestDatabase,
  testConfig,
  type TestDatabase,
} from "./helpers.js";
import { WorktreeService } from "../src/worktrees/worktree-service.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function codingAgent(): Agent {
  return {
    id: "test-coder",
    name: "Test Coder",
    description: "Writes one file into the assigned worktree.",
    capabilities: ["coding"],
    providerId: "scripted",
    model: "scripted-1",
    requiresWorkspace: true,
    toolCalling: true,
    async run(_input, context: AgentContext) {
      const workspace = context.workspace;

      if (!workspace) {
        throw new Error("No workspace");
      }

      writeFileSync(
        path.join(workspace.path, "AGENT_CHANGE.md"),
        "# changed by the test agent\n"
      );
      context.reportProgress?.({
        stage: "agent.edit",
        message: "Wrote AGENT_CHANGE.md",
        data: { tool: "write_file", paths: ["AGENT_CHANGE.md"] },
      });

      const now = new Date().toISOString();

      return {
        agentId: "test-coder",
        status: "completed",
        output: { summary: "Wrote AGENT_CHANGE.md" },
        provider: "scripted",
        model: "scripted-1",
        startedAt: now,
        completedAt: now,
        durationMs: 0,
      };
    },
  };
}

function slowAgent(): Agent {
  return {
    id: "slow-agent",
    name: "Slow Agent",
    description: "Waits until it is cancelled.",
    capabilities: [],
    providerId: "scripted",
    model: "scripted-1",
    async run(_input, context) {
      const startedAt = new Date();

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const now = new Date().toISOString();
          resolve({
            agentId: "slow-agent",
            status: "completed" as const,
            startedAt: now,
            completedAt: now,
            durationMs: 5_000,
          });
        }, 5_000);

        context.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            const now = new Date().toISOString();
            resolve({
              agentId: "slow-agent",
              status: "failed" as const,
              error: { code: "CANCELLED", message: "The run was cancelled." },
              startedAt: startedAt.toISOString(),
              completedAt: now,
              durationMs: Date.now() - startedAt.getTime(),
            });
          },
          { once: true }
        );
      });
    },
  };
}

async function waitForRun(app: FastifyInstance, runId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/runs/${runId}`,
    });
    const body = response.json();

    if (body.run?.status === "completed" || body.run?.status === "failed") {
      return body.run;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Run ${runId} did not finish in time`);
}

describe("coding run lifecycle", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let service: WorktreeService;
  let worktreesRoot: string;
  let baseUrl: string;
  const runIds: string[] = [];
  const prCalls: CreatePullRequestInput[] = [];

  beforeAll(async () => {
    db = createTestDatabase();
    worktreesRoot = mkdtempSync(path.join(tmpdir(), "taskfleet-lifecycle-"));
    service = new WorktreeService({
      repoRoot: REPO_ROOT,
      worktreesRoot,
      authorName: "TaskFleet Test",
      authorEmail: "test@taskfleet.dev",
    });
    service.push = async () => undefined;

    const githubClient = {
      async createPullRequest(input: CreatePullRequestInput) {
        prCalls.push(input);

        return {
          number: 7,
          url: "https://github.com/acme/repo/pull/7",
          state: "open",
          title: input.title,
        };
      },
    } as unknown as GitHubClient;

    const base = testConfig(db.config.databaseUrl);

    app = buildApp({
      logger: false,
      config: {
        ...base,
        github: {
          token: "fake-token",
          repository: "acme/repo",
          baseBranch: "main",
        },
        worktrees: {
          enabled: true,
          root: worktreesRoot,
          keepOnFailure: false,
          keepOnSuccess: false,
        },
        agent: {
          ...base.agent,
          testCommand: 'node -e "process.exit(0)"',
          runTests: true,
          requireChanges: true,
        },
      },
      agents: new AgentRegistry().register(codingAgent()),
      worktreeService: service,
      githubClient,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();

    for (const branch of runIds.map((runId) => `taskfleet/${runId}`)) {
      try {
        execFileSync("git", ["branch", "-D", branch], {
          cwd: REPO_ROOT,
          stdio: "pipe",
        });
      } catch {
        // The branch may already be gone.
      }
    }

    execFileSync("git", ["worktree", "prune"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    rmSync(worktreesRoot, { recursive: true, force: true });
    db.cleanup();
  });

  it("creates a worktree, edits a file, diffs, tests, commits, pushes and opens a PR", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        prompt: "Create AGENT_CHANGE.md",
        agentId: "test-coder",
        title: "Coding lifecycle",
      },
    });

    expect(created.statusCode).toBe(202);

    const createdBody = created.json();
    const runId = createdBody.run.id as string;
    runIds.push(runId);

    const run = await waitForRun(app, runId);

    expect(run.status).toBe("completed");
    expect(run.branch).toBe(`taskfleet/${runId}`);
    expect(run.baseBranch).toBe("main");
    expect(run.worktreePath).toBe(path.join(worktreesRoot, runId));
    expect(run.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(run.pullRequestUrl).toBe("https://github.com/acme/repo/pull/7");

    const types = run.events.map((event: { type: string }) => event.type);

    for (const expected of [
      "run.started",
      "workspace.created",
      "agent.started",
      "agent.edit",
      "agent.completed",
      "test.started",
      "test.completed",
      "git.commit",
      "git.push",
      "github.pr.opened",
      "workspace.removed",
      "run.completed",
    ]) {
      expect(types).toContain(expected);
    }

    const artifacts = new Map(
      (run.artifacts as Array<{ kind: string; content: string | null; data: unknown }>).map(
        (artifact) => [artifact.kind, artifact]
      )
    );

    expect(artifacts.get("diff")?.content).toContain("AGENT_CHANGE.md");
    expect(artifacts.get("changed_files")?.data).toEqual([
      expect.objectContaining({ path: "AGENT_CHANGE.md", status: "added" }),
    ]);
    expect(artifacts.get("test_results")?.data).toMatchObject({
      status: "passed",
      exitCode: 0,
    });
    expect(artifacts.get("git_commit")?.data).toMatchObject({
      sha: run.commitSha,
    });
    expect(artifacts.get("pull_request")?.data).toMatchObject({
      status: "opened",
      url: "https://github.com/acme/repo/pull/7",
      base: "main",
    });

    expect(run.output).toMatchObject({
      workspace: { branch: `taskfleet/${runId}`, baseBranch: "main" },
      changedFiles: [
        expect.objectContaining({ path: "AGENT_CHANGE.md", status: "added" }),
      ],
      commitSha: run.commitSha,
      pullRequestUrl: "https://github.com/acme/repo/pull/7",
    });

    expect(prCalls).toHaveLength(1);
    expect(prCalls[0]).toMatchObject({
      head: `taskfleet/${runId}`,
      base: "main",
    });

    const task = await app.inject({
      method: "GET",
      url: `/tasks/${createdBody.task.id}`,
    });

    expect(task.json().task.status).toBe("in_review");
  });

  it("streams the coding events over SSE", async () => {
    const created = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Stream the coding lifecycle",
        agentId: "test-coder",
        title: "Streamed coding run",
      }),
    });
    const createdBody = (await created.json()) as { run: { id: string } };
    runIds.push(createdBody.run.id);

    const response = await fetch(
      `${baseUrl}/runs/${createdBody.run.id}/events`,
      { headers: { accept: "text/event-stream" } }
    );

    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";

    while (!text.includes("event: run.completed")) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      text += decoder.decode(chunk.value, { stream: true });
    }

    for (const expected of [
      "event: workspace.created",
      "event: agent.started",
      "event: agent.edit",
      "event: agent.completed",
      "event: git.commit",
      "event: git.push",
      "event: github.pr.opened",
      "event: run.completed",
    ]) {
      expect(text).toContain(expected);
    }
  });
});

describe("coding run without GitHub credentials", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let worktreesRoot: string;

  beforeAll(async () => {
    db = createTestDatabase();
    worktreesRoot = mkdtempSync(path.join(tmpdir(), "taskfleet-nogithub-"));
    const base = testConfig(db.config.databaseUrl);
    const service = new WorktreeService({
      repoRoot: REPO_ROOT,
      worktreesRoot,
      authorName: "TaskFleet Test",
      authorEmail: "test@taskfleet.dev",
    });

    app = buildApp({
      logger: false,
      config: {
        ...base,
        worktrees: {
          enabled: true,
          root: worktreesRoot,
          keepOnFailure: false,
          keepOnSuccess: false,
        },
        agent: {
          ...base.agent,
          testCommand: 'node -e "process.exit(0)"',
          runTests: true,
          requireChanges: true,
        },
      },
      agents: new AgentRegistry().register(codingAgent()),
      worktreeService: service,
      githubClient: null,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    execFileSync("git", ["worktree", "prune"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    rmSync(worktreesRoot, { recursive: true, force: true });
    db.cleanup();
  });

  it("commits locally and reports GitHub as unavailable instead of faking a PR", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "Edit without GitHub", agentId: "test-coder" },
    });
    const runId = created.json().run.id as string;

    try {
      const run = await waitForRun(app, runId);

      expect(run.status).toBe("completed");
      expect(run.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(run.pullRequestUrl).toBeNull();

      const artifact = (
        run.artifacts as Array<{ kind: string; data: unknown }>
      ).find((entry) => entry.kind === "pull_request");

      expect(artifact?.data).toMatchObject({
        status: "unavailable",
      });
      expect(
        run.events.map((event: { type: string }) => event.type)
      ).toContain("github.pr.skipped");
    } finally {
      execFileSync("git", ["branch", "-D", `taskfleet/${runId}`], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
    }
  });
});

describe("run cancellation", () => {
  let db: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createTestDatabase();
    app = buildApp({
      logger: false,
      config: db.config,
      agents: new AgentRegistry().register(slowAgent()),
      githubClient: null,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.cleanup();
  });

  it("aborts an active agent and persists a cancelled failure", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "Wait forever", agentId: "slow-agent" },
    });
    const runId = created.json().run.id as string;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.inject({ method: "GET", url: `/runs/${runId}` });

      if (response.json().run?.status === "running") {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const cancelled = await app.inject({
      method: "POST",
      url: `/runs/${runId}/cancel`,
    });

    expect(cancelled.statusCode).toBe(202);

    const run = await waitForRun(app, runId);

    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("CANCELLED");
    expect(run.events.at(-1)).toMatchObject({ type: "run.failed" });
  });
});
