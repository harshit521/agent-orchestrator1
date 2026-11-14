import type { Agent } from "../agents/base/agent.js";
import type { AgentContext } from "../agents/base/agent-context.js";
import type { AgentResult } from "../agents/base/agent-result.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { AppConfig } from "../config.js";
import type { GitHubClient } from "../github/client.js";
import type { RunEventBus, RunEventType } from "./event-bus.js";
import type {
  NewRunEvent,
  RunStore,
  RunWorkspace,
} from "./run-store.js";
import { parseJsonValue } from "./run-dto.js";
import { SecurityScanner } from "../security/scanner.js";
import {
  resolveTestCommand,
  runTests,
  type TestRunResult,
} from "./test-runner.js";
import {
  githubRemoteUrl,
  type Worktree,
  type WorktreeDiff,
  type WorktreeService,
} from "../worktrees/worktree-service.js";
import { SchedulerService } from "./scheduler/SchedulerService.ts";

export interface StartTaskRequest {
  prompt: string;
  title?: string;
  agentId: string;
  priority?: string;
}

export interface LoggerLike {
  info(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
}

export interface GitHubIntegration {
  client: GitHubClient;
  repository: string;
  baseBranch: string;
  remoteUrl?: string;
}

export interface RunServiceDeps {
  store: RunStore;
  agents: AgentRegistry;
  events: RunEventBus;
  logger: LoggerLike;
  config: AppConfig;
  worktrees: {
    enabled: boolean;
    service: WorktreeService | null;
  };
  github: GitHubIntegration | null;
  scheduler: import("./scheduler/SchedulerService.ts").SchedulerService;
}

export class UnknownAgentError extends Error {
  constructor(agentId: string) {
    super(`Unknown agent: ${agentId}`);
    this.name = "UnknownAgentError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export function deriveTitle(prompt: string): string {
  const normalised = prompt.replace(/\s+/g, " ").trim();

  return normalised.length > 80 ? `${normalised.slice(0, 77)}...` : normalised;
}

/** Scheduler for managing run execution lifecycle. */
export const scheduler = new SchedulerService({
  store,
  events,
  config,
});

/**
 * Owns the task/run lifecycle: validate the agent, persist the task, record
 * progress events, and execute the agent either in the background
 * (`startTask`) or inline (`runToCompletion`).
 *
 * Coding agents additionally get an isolated worktree, a post-execution diff,
 * tests, a commit, an optional push, and an optional GitHub pull request.
 */
export class RunService {
  readonly #store: RunStore;
  readonly #agents: AgentRegistry;
  readonly #events: RunEventBus;
  readonly #logger: LoggerLike;
  readonly #config: AppConfig;
  readonly #worktrees: RunServiceDeps["worktrees"];
  readonly #github: GitHubIntegration | null;
  readonly #controllers = new Map<string, AbortController>();
  readonly #scheduler: SchedulerService;
  #executionCallbacks: Map<string, () => Promise<void>> = new Map();
  #pending: Promise<void> = Promise.resolve();

  constructor(deps: RunServiceDeps) {
    this.#store = deps.store;
    this.#agents = deps.agents;
    this.#events = deps.events;
    this.#logger = deps.logger;
    this.#config = deps.config;
    this.#worktrees = deps.worktrees;
    this.#github = deps.github;
    this.#scheduler = deps.scheduler;

    // Register completion callback with scheduler
    // The scheduler will call this when a run completes
    this.#executionCallbacks = new Map();
  }

  /**
   * Register a completion callback for a run.
   * The scheduler will call this when the run completes.
   */
  registerCompletionCallback(runId: string, callback: () => Promise<void>) {
    this.#executionCallbacks.set(runId, callback);
  }

  /** Creates a task and enqueues its first run in the scheduler. */
  async startTask(request: StartTaskRequest) {
    const agent = this.#requireAgent(request.agentId);
    const { task, run } = await this.#store.createTaskWithRun({
      title: request.title?.trim() || deriveTitle(request.prompt),
      prompt: request.prompt,
      agentId: agent.id,
      priority: request.priority ?? "medium",
    });

    // Enqueue the run in the scheduler instead of fire-and-forget
    await this.#scheduler.enqueue(run);

    return { task, run };
  }

  /** Creates a queued task without executing it. */
  async createQueuedTask(request: StartTaskRequest) {
    const agent = this.#requireAgent(request.agentId);
    const task = await this.#store.createTask({
      title: request.title?.trim() || deriveTitle(request.prompt),
      prompt: request.prompt,
      agentId: agent.id,
      priority: request.priority ?? "medium",
    });

    return { task };
  }

  /** Starts another run for an existing task, enqueued in the scheduler. */
  async startExistingTask(taskId: string) {
    const task = await this.#store.getTask(taskId);

    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const agent = this.#requireAgent(task.agentId);
    const { task: updatedTask, run } = await this.#store.startRunForTask(
      task.id,
      agent.id
    );

    // Enqueue the run in the scheduler instead of fire-and-forget
    await this.#scheduler.enqueue(run);

    return { task: updatedTask, run };
  }

  async runToCompletion(request: StartTaskRequest) {
    const agent = this.#requireAgent(request.agentId);
    const title = request.title?.trim() || deriveTitle(request.prompt);
    const { task, run } = await this.#store.createTaskWithRun({
      title,
      prompt: request.prompt,
      agentId: agent.id,
      priority: request.priority ?? "medium",
    });
    const result = await this.#execute(
      task.id,
      run.id,
      agent,
      request.prompt,
      title
    );

    return { task, run, result };
  }

  /** Cooperatively cancels a running agent and its child processes. */
  cancelRun(runId: string): boolean {
    // First try to cancel via scheduler (queued runs)
    const schedulerCancelled = this.#scheduler.cancelRun(runId);
    if (schedulerCancelled) {
      // Emit cancelled event
      this.#events.publish({
        id: crypto.randomUUID(),
        runId,
        taskId: this.#store.findRunById(runId)?.then((r) => r.taskId) ?? "",
        type: "run.cancelled",
        message: `Run ${runId} cancelled`,
        percent: 100,
        createdAt: new Date().toISOString(),
      });
      return true;
    }

    // Then try via AbortController (running runs)
    const controller = this.#controllers.get(runId);

    if (!controller) {
      return false;
    }

    controller.abort();
    
    // Persist cancellation status
    void this.#store.updateRunStatus(runId, "cancelled");

    // Emit cancelled event
    this.#events.publish({
      id: crypto.randomUUID(),
      runId,
      taskId: "",
      type: "run.cancelled",
      message: `Run ${runId} cancelled`,
      percent: 100,
      createdAt: new Date().toISOString(),
    });

    return true;
  }

  isRunning(runId: string): boolean {
    return this.#controllers.has(runId);
  }

  #launch(
    taskId: string,
    runId: string,
    agent: Agent,
    prompt: string,
    title: string
  ): void {
    void this.#execute(taskId, runId, agent, prompt, title).catch(
      (error: unknown) => {
        this.#logger.error(
          { err: error, taskId, runId },
          "Background run failed"
        );
      }
    );
  }

  #requireAgent(agentId: string): Agent {
    const agent = this.#agents.get(agentId);

    if (!agent) {
      throw new UnknownAgentError(agentId);
    }

    return agent;
  }

  #requireWorktreeService(): WorktreeService {
    const service = this.#worktrees.service;

    if (!this.#worktrees.enabled || !service) {
      throw new Error(
        "Git worktrees are disabled. Set WORKTREES_ENABLED=true to run the coding agent."
      );
    }

    return service;
  }

  async #execute(
    taskId: string,
    runId: string,
    agent: Agent,
    prompt: string,
    title: string
  ): Promise<AgentResult> {
    const startedAt = new Date();
    const controller = new AbortController();
    this.#controllers.set(runId, controller);

    let worktree: Worktree | null = null;
    let result: AgentResult | null = null;

    try {
      await this.#record(runId, taskId, {
        type: "run.started",
        stage: "started",
        message: `Run created for ${agent.name}`,
        percent: 0,
      });

      const context: AgentContext = {
        taskId,
        runId,
        originalPrompt: prompt,
        previousResults: {},
        signal: controller.signal,
        reportProgress: (progress) => {
          const type: RunEventType =
            progress.stage === "agent.edit" ? "agent.edit" : "agent.progress";

          void this.#record(runId, taskId, {
            type,
            stage: progress.stage,
            message: progress.message,
            ...(progress.percent !== undefined
              ? { percent: progress.percent }
              : {}),
            ...(progress.data !== undefined ? { data: progress.data } : {}),
          });
        },
      };

      if (agent.requiresWorkspace) {
        try {
          worktree = await this.#prepareWorkspace(taskId, runId);
          context.workspace = {
            taskId,
            runId,
            path: worktree.path,
            branch: worktree.branch,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to create the run worktree.";

          await this.#record(runId, taskId, {
            type: "agent.failed",
            stage: "workspace.failed",
            message,
            percent: 5,
            data: { code: "WORKSPACE_UNAVAILABLE" },
          });

          result = this.#failure(
            "WORKSPACE_UNAVAILABLE",
            message,
            startedAt
          );
        }
      }

      if (!result) {
        await this.#record(runId, taskId, {
          type: "agent.started",
          stage: "agent.started",
          message: `${agent.name} (${agent.providerId ?? "unknown"} · ${
            agent.model ?? "unknown model"
          }) started`,
          percent: 5,
        });

        result = await this.#runAgent(agent, prompt, context, startedAt);

        await this.#record(
          runId,
          taskId,
          result.status === "completed"
            ? {
                type: "agent.completed",
                stage: "agent.completed",
                message: `${agent.name} completed in ${result.durationMs}ms`,
                percent: 90,
                ...(result.usage ? { data: result.usage } : {}),
              }
            : {
                type: "agent.failed",
                stage: "agent.failed",
                message: result.error?.message ?? `${agent.name} failed`,
                percent: 90,
                ...(result.error ? { data: result.error } : {}),
              }
        );

        if (worktree) {
          result = await this.#postProcessCodingRun({
            taskId,
            runId,
            title,
            worktree,
            result,
            startedAt,
            signal: controller.signal,
          });
        }
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "The run failed with an unexpected error.";

      result = this.#failure("RUN_FAILED", message, startedAt);
      await this.#store.addArtifact(runId, {
        kind: "agent_error",
        title: "Run failure",
        data: { code: "RUN_FAILED", message },
      });
    } finally {
      if (worktree) {
        await this.#cleanupWorkspace(runId, taskId, worktree, result);
      }

      this.#controllers.delete(runId);
    }

    const finalResult =
      result ??
      this.#failure("RUN_FAILED", "The run ended without a result.", startedAt);

    // Make sure progress events are durable before the terminal event.
    await this.#pending;
    await this.#store.completeRun(runId, finalResult);

    // Notify scheduler of run completion
    void this.#scheduler.registerCompletionCallback(runId, async () => {
      // Scheduler will handle processing the next queued run
    });

    const taskStatus =
      finalResult.status === "completed"
        ? this.#completedTaskStatus(finalResult)
        : "failed";
    await this.#store.updateTaskStatus(taskId, taskStatus);

    await this.#record(runId, taskId, {
      type: finalResult.status === "completed" ? "run.completed" : "run.failed",
      stage: finalResult.status,
      message:
        finalResult.status === "completed"
          ? `Completed in ${finalResult.durationMs}ms`
          : (finalResult.error?.message ?? "Run failed"),
      percent: 100,
      ...(finalResult.error ? { data: finalResult.error } : {}),
    });

    return finalResult;
  }

  async #prepareWorkspace(taskId: string, runId: string): Promise<Worktree> {
    const service = this.#requireWorktreeService();
    const worktree = await service.ensureForRun(taskId, runId);
    const workspace: RunWorkspace = {
      branch: worktree.branch,
      worktreePath: worktree.path,
      baseBranch: this.#config.github.baseBranch,
    };

    await this.#store.updateRunWorkspace(runId, workspace);
    await this.#record(runId, taskId, {
      type: "workspace.created",
      stage: "workspace.created",
      message: `Worktree ready on ${worktree.branch}`,
      percent: 3,
      data: {
        branch: worktree.branch,
        worktreePath: worktree.path,
        baseBranch: workspace.baseBranch,
      },
    });

    return worktree;
  }

  async #runAgent(
    agent: Agent,
    prompt: string,
    context: AgentContext,
    startedAt: Date
  ): Promise<AgentResult> {
    try {
      return await agent.run({ prompt }, context);
    } catch (error: unknown) {
      return this.#failure(
        "AGENT_CRASHED",
        error instanceof Error
          ? error.message
          : "The agent threw an unexpected error.",
        startedAt
      );
    }
  }

  async #postProcessCodingRun(input: {
    taskId: string;
    runId: string;
    title: string;
    worktree: Worktree;
    result: AgentResult;
    startedAt: Date;
    signal: AbortSignal;
  }): Promise<AgentResult> {
    const { taskId, runId, title, worktree, signal } = input;
    const service = this.#requireWorktreeService();

    let diff: WorktreeDiff;

    try {
      diff = await service.diff(worktree);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to generate a diff.";

      await this.#store.addArtifact(runId, {
        kind: "agent_error",
        title: "Diff generation failed",
        data: { code: "DIFF_FAILED", message },
      });

      return this.#failure("DIFF_FAILED", message, input.startedAt, input.result);
    }

    await this.#store.addArtifact(runId, {
      kind: "changed_files",
      title: "Changed files",
      data: diff.files,
    });
    await this.#store.addArtifact(runId, {
      kind: "diff",
      title: "Unified diff",
      content: diff.diff,
      data: { files: diff.files, truncated: diff.truncated },
    });

    if (input.result.status !== "completed") {
      return input.result;
    }

    if (this.#config.agent.requireChanges && diff.files.length === 0) {
      return this.#failure(
        "AGENT_NO_CHANGES",
        "The agent completed without modifying any files in the worktree.",
        input.startedAt,
        input.result
      );
    }

    let testResult: TestRunResult | null = null;

    if (this.#config.agent.runTests) {
      const command = await resolveTestCommand(
        worktree.path,
        this.#config.agent.testCommand
      );

      if (!command) {
        await this.#store.addArtifact(runId, {
          kind: "test_results",
          title: "Test results",
          data: {
            status: "skipped",
            reason:
              "No test command was detected. Set AGENT_TEST_COMMAND to enable automatic tests.",
          },
        });
      } else {
        await this.#record(runId, taskId, {
          type: "test.started",
          stage: "tests.started",
          message: `Running ${command.command} ${command.args.join(" ")}`.trim(),
          percent: 92,
          data: { command: command.command, args: command.args },
        });

        testResult = await runTests(worktree.path, command, {
          timeoutMs: this.#config.agent.testTimeoutMs,
          signal,
        });

        await this.#store.addArtifact(runId, {
          kind: "test_results",
          title: "Test results",
          data: testResult,
        });
        await this.#record(runId, taskId, {
          type: "test.completed",
          stage: "tests.completed",
          message:
            testResult.status === "passed"
              ? `Tests passed in ${testResult.durationMs}ms`
              : `Tests ${testResult.status}: ${
                  testResult.reason ??
                  testResult.stderr.split("\n").find((line) => line.length > 0) ??
                  "see test artifact"
                }`,
          percent: 94,
          data: {
            status: testResult.status,
            exitCode: testResult.exitCode,
            durationMs: testResult.durationMs,
          },
        });

        if (testResult.status !== "passed") {
          return this.#failure(
            "TESTS_FAILED",
            testResult.reason ??
              `Tests failed with exit code ${testResult.exitCode ?? "unknown"}.`,
            input.startedAt,
            input.result,
            { tests: testResult }
          );
        }
      }
    }

    // Run security scan on the worktree/diff
    const securityResult = await this.#runSecurityScan(worktree.path, runId);

    // Evaluate security policy
    const policyResult = this.#evaluateSecurityPolicy(securityResult);

    if (policyResult.block) {
      // Fail-closed policy detected blocking finding(s)
      // Do not commit, do not push, do not create PR
      await this.#store.completeRun(runId, {
        status: "failed" as const,
        provider: null,
        model: null,
        completedAt: new Date(),
        durationMs: input.result?.durationMs ?? 0,
        inputTokens: null,
        outputTokens: null,
        output: null,
        error: {
          code: "SECURITY_GATE_FAILED",
          message: "Security gate failed. " + policyResult.reason,
        },
      });

      // Mark task status as failed
      await this.#store.updateTaskStatus(taskId, "failed");

      // Emit security scan failed event
      this.#events.publish({
        id: crypto.randomUUID(),
        runId,
        taskId,
        type: "security.scan.failed" as RunEventType,
        message: `Security gate failed: ${policyResult.reason}`,
        percent: 100,
        createdAt: new Date().toISOString(),
      });

      return input.result;
    }

    // Continue with git commit for successful/clean scans
    // Re-stage in case the test runner generated files that are not ignored.
    diff = await service.diff(worktree);

    const commitMessage = [
      `taskfleet: ${title}`,
      "",
      `Run: ${runId}`,
      `Files changed: ${diff.files.length}`,
    ].join("\n");

    let commitSha: string;

    try {
      commitSha = await service.commit(worktree, commitMessage);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create a commit.";

      return this.#failure(
        "GIT_COMMIT_FAILED",
        message,
        input.startedAt,
        input.result,
        { tests: testResult }
      );
    }

    await this.#store.updateRunGit(runId, { commitSha });
    await this.#store.addArtifact(runId, {
      kind: "git_commit",
      title: "Git commit",
      data: { sha: commitSha, message: commitMessage, files: diff.files },
    });
    await this.#record(runId, taskId, {
      type: "git.commit",
      stage: "git.commit",
      message: `Committed ${commitSha.slice(0, 12)} on ${worktree.branch}`,
      percent: 96,
      data: { sha: commitSha, branch: worktree.branch, files: diff.files },
    });

    let pullRequestUrl: string | null = null;
    let githubStatus: "pushed" | "skipped" | "failed" = "skipped";

    if (!this.#github) {
      await this.#store.addArtifact(runId, {
        kind: "pull_request",
        title: "GitHub pull request",
        data: {
          status: "unavailable",
          reason:
            "GitHub is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY to push and open a PR.",
        },
      });
      await this.#record(runId, taskId, {
        type: "github.pr.skipped",
        stage: "github.skipped",
        message:
          "GitHub is not configured; the commit remains local. Set GITHUB_TOKEN and GITHUB_REPOSITORY to publish it.",
        percent: 98,
        data: { status: "unavailable" },
      });
    } else {
      const remoteUrl =
        this.#github.remoteUrl ??
        this.#config.github.remoteUrl ??
        githubRemoteUrl(this.#github.repository);

      try {
        await service.push(worktree, {
          remoteUrl,
          token: this.#requireGithubToken(),
          branch: worktree.branch,
        });
        githubStatus = "pushed";

        await this.#record(runId, taskId, {
          type: "git.push",
          stage: "git.push",
          message: `Pushed ${worktree.branch} to ${this.#github.repository}`,
          percent: 97,
          data: {
            branch: worktree.branch,
            repository: this.#github.repository,
          },
        });

        const pullRequest = await this.#github.client.createPullRequest({
          title,
          head: worktree.branch,
          base: this.#github.baseBranch,
          body: [
            "Created by the TaskFleet coding agent.",
            "",
            `Run: ${runId}`,
            `Commit: ${commitSha}`,
            `Changed files: ${diff.files.length}`,
            ...(testResult
              ? [`Tests: ${testResult.status} (exit ${testResult.exitCode ?? "n/a"})`]
              : []),
          ].join("\n"),
        });

        pullRequestUrl = pullRequest.url;
        await this.#store.updateRunGit(runId, { pullRequestUrl });
        await this.#store.addArtifact(runId, {
          kind: "pull_request",
          title: "GitHub pull request",
          data: {
            status: "opened",
            number: pullRequest.number,
            url: pullRequest.url,
            head: worktree.branch,
            base: this.#github.baseBranch,
          },
        });
        await this.#record(runId, taskId, {
          type: "github.pr.opened",
          stage: "github.pr.opened",
          message: `Opened pull request #${pullRequest.number}`,
          percent: 99,
          data: {
            number: pullRequest.number,
            url: pullRequest.url,
            head: worktree.branch,
            base: this.#github.baseBranch,
          },
        });
      } catch (error: unknown) {
        githubStatus = "failed";
        const message =
          error instanceof Error
            ? error.message
            : "GitHub integration failed.";

        await this.#store.addArtifact(runId, {
          kind: "pull_request",
          title: "GitHub pull request",
          data: { status: "failed", reason: message },
        });

        const code = message.toLowerCase().includes("pull request")
          ? "GITHUB_PR_FAILED"
          : "GIT_PUSH_FAILED";

        return this.#failure(code, message, input.startedAt, input.result, {
          tests: testResult,
          commitSha,
          githubStatus,
        });
      }
    }

    const output =
      typeof input.result.output === "object" &&
      input.result.output !== null &&
      !Array.isArray(input.result.output)
        ? (input.result.output as Record<string, unknown>)
        : {};

    return {
      ...input.result,
      output: {
        ...output,
        summary:
          typeof output.summary === "string"
            ? output.summary
            : "Coding run completed.",
        workspace: {
          branch: worktree.branch,
          path: worktree.path,
          baseBranch: this.#config.github.baseBranch,
        },
        changedFiles: diff.files,
        diff: { truncated: diff.truncated, bytes: diff.diff.length },
        tests: testResult,
        commitSha,
        pullRequestUrl,
        github: {
          status: githubStatus,
          repository: this.#github?.repository ?? null,
        },
      },
    };
  }

  async #cleanupWorkspace(
    runId: string,
    taskId: string,
    worktree: Worktree,
    result: AgentResult | null
  ): Promise<void> {
    const keep =
      result?.status === "completed"
        ? this.#config.worktrees.keepOnSuccess
        : this.#config.worktrees.keepOnFailure;

    if (keep) {
      return;
    }

    try {
      await this.#requireWorktreeService().remove(worktree);
      await this.#record(runId, taskId, {
        type: "workspace.removed",
        stage: "workspace.removed",
        message: `Removed worktree ${worktree.path}`,
        percent: 99,
        data: { worktreePath: worktree.path, branch: worktree.branch },
      });
    } catch (error: unknown) {
      this.#logger.error(
        { err: error, runId, worktreePath: worktree.path },
        "Failed to remove run worktree"
      );
    }
  }

  #completedTaskStatus(result: AgentResult): string {
    const output =
      typeof result.output === "object" && result.output !== null
        ? (result.output as { pullRequestUrl?: unknown })
        : null;

    return typeof output?.pullRequestUrl === "string"
      ? "in_review"
      : "completed";
  }

  #requireGithubToken(): string {
    const token = this.#config.github.token;

    if (!token) {
      throw new Error("GITHUB_TOKEN is not configured.");
    }

    return token;
  }

  #failure(
    code: string,
    message: string,
    startedAt: Date,
    base?: AgentResult,
    output?: Record<string, unknown>
  ): AgentResult {
    const mergedOutput =
      output ??
      (typeof base?.output === "object" &&
      base.output !== null &&
      !Array.isArray(base.output)
        ? (base.output as Record<string, unknown>)
        : undefined);

    return {
      agentId: base?.agentId ?? "unknown",
      status: "failed",
      ...(mergedOutput ? { output: mergedOutput } : {}),
      error: { code, message },
      ...(base?.provider ? { provider: base.provider } : {}),
      ...(base?.model ? { model: base.model } : {}),
      ...(base?.usage ? { usage: base.usage } : {}),
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    };
  }

  /**
   * Events are persisted and published strictly in order. Progress callbacks
   * fire synchronously from the agent, so they are chained instead of being
   * awaited by the agent itself.
   */
  #record(
    runId: string,
    taskId: string,
    event: NewRunEvent
  ): Promise<void> {
    this.#pending = this.#pending
      .then(async () => {
        const saved = await this.#store.appendEvent(runId, event);

        this.#events.publish({
          id: saved.id,
          runId,
          taskId,
          type: saved.type as RunEventType,
          ...(saved.stage ? { stage: saved.stage } : {}),
          message: saved.message,
          ...(saved.percent !== null ? { percent: saved.percent } : {}),
          ...(saved.data !== null
            ? { data: parseJsonValue(saved.data) }
            : {}),
          createdAt: saved.createdAt.toISOString(),
        });
      })
      .catch((error: unknown) => {
        this.#logger.error(
          { err: error, runId },
          "Failed to record run event"
        );
      });

    return this.#pending;
  }

  /**
   * Run security scanners on the worktree/diff.
   * Scans the isolated worktree rather than the original repository.
   */
  async #runSecurityScan(worktreePath: string, runId: string): Promise<{
    scannerResults: Array<{ scannerId: string; status: string; output: string }>;
    findings: Array<{ severity: string; description: string; affectedFile: string; lineNumber: number }>;
  }> {
    const scanner = new SecurityScanner({
      root: worktreePath,
      definitions: this.#config.security.scanners
        ? this.#config.security.scanners
        : undefined,
      timeoutMs: this.#config.security.scanTimeoutMs,
    });

    const scannerResults = await scanner.scan(worktreePath);

    const findings: Array<{ severity: string; description: string; affectedFile: string; lineNumber: number }> = [];

    for (const result of scannerResults) {
      // Parse findings from scanner output
      // This is simplified - real implementation would parse JSON output
      if (result.status === "failed") {
        // Extract findings from output
        const lines = result.output.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            findings.push({
              severity: "medium",
              description: line.substring(0, 100),
              affectedFile: "unknown",
              lineNumber: 0,
            });
          }
        }
      }
    }

    // Persist security results to database
    await this.#store.#prisma.$runSecurity.createMany({
      data: scannerResults.map((result) => ({
        runId,
        scannerId: result.id,
        status: result.status,
        severity: "high", // simplified
        description: result.output.slice(0, 500),
        affectedFile: "",
        lineNumber: 0,
        scannedAt: new Date(),
      })),
    });

    return {
      scannerResults: scannerResults.map((r) => ({
        scannerId: r.id,
        status: r.status,
        output: r.output,
      })),
      findings,
    };
  }

  /**
   * Evaluate security policy against scan results.
   * - fail-closed: blocking findings prevent commit/PR
   * - warn-only: warnings are reported but don't block
   */
  #evaluateSecurityPolicy(
    securityScan: {
      scannerResults: Array<{ scannerId: string; status: string; output: string }>;
      findings: Array<{ severity: string; description: string; affectedFile: string; lineNumber: number }>;
    }
  ): {
    block: boolean;
    reason: string;
  } {
    const { findings } = securityScan;

    // Check for high/critical severity findings
    const blockingFindings = findings.filter(
      (f) => f.severity === "high" || f.severity === "critical"
    );

    if (blockingFindings.length > 0) {
      return {
        block: true,
        reason: `Security gate blocked: ${blockingFindings.length} blocking finding(s) detected`,
      };
    }

    // Check for any findings in warn-only mode
    const warningFindings = findings.filter((f) => f.severity === "low");

    if (warningFindings.length > 0 && this.#config.security.policy === "warn-only") {
      return {
        block: false,
        reason: `Security warnings detected (${warningFindings.length}), but policy is set to warn-only`,
      };
    }

    return {
      block: false,
      reason: "Security scan passed",
    };
  }
}
