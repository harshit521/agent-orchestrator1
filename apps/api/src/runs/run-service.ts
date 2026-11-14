import type { Agent } from "../agents/base/agent.js";
import type { AgentContext } from "../agents/base/agent-context.js";
import type { AgentResult } from "../agents/base/agent-result.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { RunEventBus, RunEventType } from "./event-bus.js";
import type { NewRunEvent, RunStore } from "./run-store.js";
import { parseJsonValue } from "./run-dto.js";

export interface StartTaskRequest {
  prompt: string;
  title?: string;
  agentId: string;
}

export interface LoggerLike {
  info(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
}

export interface RunServiceDeps {
  store: RunStore;
  agents: AgentRegistry;
  events: RunEventBus;
  logger: LoggerLike;
}

export class UnknownAgentError extends Error {
  constructor(agentId: string) {
    super(`Unknown agent: ${agentId}`);
    this.name = "UnknownAgentError";
  }
}

export function deriveTitle(prompt: string): string {
  const normalised = prompt.replace(/\s+/g, " ").trim();

  return normalised.length > 80 ? `${normalised.slice(0, 77)}...` : normalised;
}

/**
 * Owns the task/run lifecycle: validate the agent, persist the task, record
 * progress events, and execute the agent either in the background
 * (`startTask`) or inline (`runToCompletion`).
 */
export class RunService {
  readonly #store: RunStore;
  readonly #agents: AgentRegistry;
  readonly #events: RunEventBus;
  readonly #logger: LoggerLike;
  #pending: Promise<void> = Promise.resolve();

  constructor(deps: RunServiceDeps) {
    this.#store = deps.store;
    this.#agents = deps.agents;
    this.#events = deps.events;
    this.#logger = deps.logger;
  }

  async startTask(request: StartTaskRequest) {
    const agent = this.#requireAgent(request.agentId);
    const { task, run } = await this.#create(request, agent);

    void this.#execute(task.id, run.id, agent, request.prompt).catch(
      (error: unknown) => {
        this.#logger.error(
          { err: error, taskId: task.id, runId: run.id },
          "Background run failed"
        );
      }
    );

    return { task, run };
  }

  async runToCompletion(request: StartTaskRequest) {
    const agent = this.#requireAgent(request.agentId);
    const { task, run } = await this.#create(request, agent);
    const result = await this.#execute(
      task.id,
      run.id,
      agent,
      request.prompt
    );

    return { task, run, result };
  }

  #requireAgent(agentId: string): Agent {
    const agent = this.#agents.get(agentId);

    if (!agent) {
      throw new UnknownAgentError(agentId);
    }

    return agent;
  }

  async #create(request: StartTaskRequest, agent: Agent) {
    return this.#store.createTaskWithRun({
      title: request.title?.trim() || deriveTitle(request.prompt),
      prompt: request.prompt,
      agentId: agent.id,
    });
  }

  async #execute(
    taskId: string,
    runId: string,
    agent: Agent,
    prompt: string
  ): Promise<AgentResult> {
    const startedAt = new Date();

    await this.#record(runId, taskId, {
      type: "run.started",
      stage: "started",
      message: `Running ${agent.name}`,
      percent: 0,
    });

    const context: AgentContext = {
      taskId,
      runId,
      originalPrompt: prompt,
      previousResults: {},
      reportProgress: (progress) => {
        void this.#record(runId, taskId, {
          type: "run.progress",
          stage: progress.stage,
          message: progress.message,
          ...(progress.percent !== undefined
            ? { percent: progress.percent }
            : {}),
          ...(progress.data !== undefined ? { data: progress.data } : {}),
        });
      },
    };

    let result: AgentResult;

    try {
      result = await agent.run({ prompt }, context);
    } catch (error: unknown) {
      result = {
        agentId: agent.id,
        status: "failed",
        error: {
          code: "AGENT_CRASHED",
          message:
            error instanceof Error
              ? error.message
              : "The agent threw an unexpected error.",
        },
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      };
    }

    // Make sure progress events are durable before the terminal event.
    await this.#pending;
    await this.#store.completeRun(runId, result);
    await this.#store.updateTaskStatus(
      taskId,
      result.status === "completed" ? "completed" : "failed"
    );

    await this.#record(runId, taskId, {
      type: result.status === "completed" ? "run.completed" : "run.failed",
      stage: result.status,
      message:
        result.status === "completed"
          ? `Completed in ${result.durationMs}ms`
          : (result.error?.message ?? "Run failed"),
      percent: 100,
      ...(result.error ? { data: result.error } : {}),
    });

    return result;
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
}
