import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";

import type { Agent } from "../agents/base/agent.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { RunEventBus } from "../runs/event-bus.js";
import type {
  AgentRunStats,
  RunStore,
  UpdateTaskInput,
} from "../runs/run-store.js";
import type { WorktreeService } from "../worktrees/worktree-service.js";
import { eventToDto, parseJsonValue, runToDto } from "../runs/run-dto.js";
import {
  RunService,
  type StartTaskRequest,
  TaskNotFoundError,
  UnknownAgentError,
} from "../runs/run-service.js";
import {
  activityQuerySchema,
  createTaskSchema,
  listRunsQuerySchema,
  researchRequestSchema,
  updateTaskSchema,
} from "./schemas.js";

export interface IntegrationStatus {
  llm: {
    provider: string;
    model: string | null;
    configured: boolean;
  };
  github: {
    repository: string | null;
    tokenConfigured: boolean;
    webhookConfigured: boolean;
  };
  worktrees: {
    enabled: boolean;
  };
  security: {
    enabled: boolean;
  };
}

export interface RouteDependencies {
  agents: AgentRegistry;
  store: RunStore;
  events: RunEventBus;
  runService: RunService;
  worktrees: {
    enabled: boolean;
    service: WorktreeService;
  };
  integrations: IntegrationStatus;
}

function validationError(reply: FastifyReply, error: ZodError) {
  return reply.status(400).send({
    success: false,
    error: "Invalid request.",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

function emptyStats(agentId: string): AgentRunStats {
  return {
    agentId,
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    activeRuns: 0,
    lastStartedAt: null,
  };
}

function agentToDto(agent: Agent, stats: AgentRunStats) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
    provider: agent.providerId ?? null,
    model: agent.model ?? null,
    status: stats.activeRuns > 0 ? "running" : "idle",
    stats,
  };
}

export function registerRoutes(
  app: FastifyInstance,
  deps: RouteDependencies
): void {
  app.get("/health", async () => ({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/integrations", async () => ({
    success: true,
    health: {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
    },
    ...deps.integrations,
  }));

  app.get("/stats", async () => {
    const [stats, recentActivity] = await Promise.all([
      deps.store.getStats(),
      deps.store.listRecentActivity(12),
    ]);

    return {
      success: true,
      tasks: stats.tasks,
      runs: stats.runs,
      agents: { total: deps.agents.list().length },
      activeRuns: stats.activeRuns.map((run) => ({
        ...runToDto(run),
        task: run.task,
      })),
      recentActivity: recentActivity.map((event) => ({
        id: event.id,
        runId: event.runId,
        taskId: event.run.task.id,
        taskTitle: event.run.task.title,
        runStatus: event.run.status,
        type: event.type,
        stage: event.stage,
        message: event.message,
        percent: event.percent,
        data: parseJsonValue(event.data),
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  app.get("/activity", async (request, reply) => {
    const parsed = activityQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const events = await deps.store.listRecentActivity(parsed.data.limit);

    return {
      success: true,
      activity: events.map((event) => ({
        id: event.id,
        runId: event.runId,
        taskId: event.run.task.id,
        taskTitle: event.run.task.title,
        runStatus: event.run.status,
        type: event.type,
        stage: event.stage,
        message: event.message,
        percent: event.percent,
        data: parseJsonValue(event.data),
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  app.get("/agents", async () => {
    const stats = await deps.store.agentStats();
    const byAgent = new Map(stats.map((entry) => [entry.agentId, entry]));

    return {
      success: true,
      agents: deps.agents.list().map((agent) =>
        agentToDto(agent, byAgent.get(agent.id) ?? emptyStats(agent.id))
      ),
    };
  });

  app.get<{ Params: { agentId: string } }>(
    "/agents/:agentId",
    async (request, reply) => {
      const agent = deps.agents.get(request.params.agentId);

      if (!agent) {
        return reply
          .status(404)
          .send({ success: false, error: "Agent not found." });
      }

      const stats = await deps.store.agentStats(agent.id);
      const recentRuns = await deps.store.listRuns({
        agentId: agent.id,
        limit: 10,
      });

      return {
        success: true,
        agent: agentToDto(agent, stats[0] ?? emptyStats(agent.id)),
        recentRuns: recentRuns.map(runToDto),
      };
    }
  );

  app.get("/worktrees", async () => {
    if (!deps.worktrees.enabled) {
      return { success: true, enabled: false, worktrees: [] };
    }

    const isGitRepository = await deps.worktrees.service.isGitRepository();

    return {
      success: true,
      enabled: true,
      isGitRepository,
      worktrees: isGitRepository
        ? await deps.worktrees.service.list()
        : [],
    };
  });

  app.post("/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    try {
      const startRequest = toStartRequest(parsed.data);

      if (!parsed.data.start) {
        const { task } = await deps.runService.createQueuedTask(startRequest);

        return reply.status(201).send({
          success: true,
          task: { ...task, runs: task.runs.map(runToDto) },
          run: null,
        });
      }

      const { task, run } = await deps.runService.startTask(startRequest);

      return reply.status(202).send({
        success: true,
        task: { ...task, runs: task.runs.map(runToDto) },
        run: runToDto(run),
      });
    } catch (error: unknown) {
      if (error instanceof UnknownAgentError) {
        return reply.status(404).send({
          success: false,
          error: error.message,
        });
      }

      throw error;
    }
  });

  app.get("/tasks", async () => {
    const tasks = await deps.store.listTasks();

    return {
      success: true,
      tasks: tasks.map((task) => ({
        ...task,
        runs: task.runs.map(runToDto),
      })),
    };
  });

  app.get<{ Params: { taskId: string } }>(
    "/tasks/:taskId",
    async (request, reply) => {
      const task = await deps.store.getTask(request.params.taskId);

      if (!task) {
        return reply
          .status(404)
          .send({ success: false, error: "Task not found." });
      }

      return {
        success: true,
        task: {
          ...task,
          runs: task.runs.map((run) => ({
            ...runToDto(run),
            events: run.events.map(eventToDto),
          })),
        },
      };
    }
  );

  app.patch<{ Params: { taskId: string } }>(
    "/tasks/:taskId",
    async (request, reply) => {
      const parsed = updateTaskSchema.safeParse(request.body);

      if (!parsed.success) {
        return validationError(reply, parsed.error);
      }

      const existing = await deps.store.getTask(request.params.taskId);

      if (!existing) {
        return reply
          .status(404)
          .send({ success: false, error: "Task not found." });
      }

      if (
        parsed.data.agentId !== undefined &&
        !deps.agents.get(parsed.data.agentId)
      ) {
        return reply.status(404).send({
          success: false,
          error: `Unknown agent: ${parsed.data.agentId}`,
        });
      }

      const patch: UpdateTaskInput = {};

      if (parsed.data.title !== undefined) {
        patch.title = parsed.data.title;
      }

      if (parsed.data.prompt !== undefined) {
        patch.prompt = parsed.data.prompt;
      }

      if (parsed.data.agentId !== undefined) {
        patch.agentId = parsed.data.agentId;
      }

      if (parsed.data.priority !== undefined) {
        patch.priority = parsed.data.priority;
      }

      if (parsed.data.status !== undefined) {
        patch.status = parsed.data.status;
      }

      const task = await deps.store.updateTask(existing.id, patch);

      return {
        success: true,
        task: {
          ...task,
          runs: task.runs.map(runToDto),
        },
      };
    }
  );

  app.delete<{ Params: { taskId: string } }>(
    "/tasks/:taskId",
    async (request, reply) => {
      const existing = await deps.store.getTask(request.params.taskId);

      if (!existing) {
        return reply
          .status(404)
          .send({ success: false, error: "Task not found." });
      }

      await deps.store.deleteTask(existing.id);

      return { success: true };
    }
  );

  app.post<{ Params: { taskId: string } }>(
    "/tasks/:taskId/run",
    async (request, reply) => {
      try {
        const { task, run } = await deps.runService.startExistingTask(
          request.params.taskId
        );

        return reply.status(202).send({
          success: true,
          task: { ...task, runs: task.runs.map(runToDto) },
          run: runToDto(run),
        });
      } catch (error: unknown) {
        if (error instanceof TaskNotFoundError) {
          return reply
            .status(404)
            .send({ success: false, error: "Task not found." });
        }

        if (error instanceof UnknownAgentError) {
          return reply.status(404).send({
            success: false,
            error: error.message,
          });
        }

        throw error;
      }
    }
  );

  app.get("/runs", async (request, reply) => {
    const parsed = listRunsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const runs = await deps.store.listRuns({
      limit: parsed.data.limit,
      ...(parsed.data.status !== undefined
        ? { status: parsed.data.status }
        : {}),
      ...(parsed.data.agentId !== undefined
        ? { agentId: parsed.data.agentId }
        : {}),
      ...(parsed.data.taskId !== undefined
        ? { taskId: parsed.data.taskId }
        : {}),
    });

    return {
      success: true,
      runs: runs.map(runToDto),
    };
  });

  app.get<{ Params: { runId: string } }>(
    "/runs/:runId",
    async (request, reply) => {
      const run = await deps.store.getRun(request.params.runId);

      if (!run) {
        return reply
          .status(404)
          .send({ success: false, error: "Run not found." });
      }

      return {
        success: true,
        run: {
          ...runToDto(run),
          events: run.events.map(eventToDto),
        },
      };
    }
  );

  /**
   * Server-Sent Events stream for a single run. Persisted events are replayed
   * first, then live progress is forwarded. The stream closes automatically
   * once the run reaches a terminal state.
   */
  app.get<{ Params: { runId: string } }>(
    "/runs/:runId/events",
    async (request, reply) => {
      const run = await deps.store.getRun(request.params.runId);

      if (!run) {
        return reply
          .status(404)
          .send({ success: false, error: "Run not found." });
      }

      reply.hijack();

      const response = reply.raw;
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      response.write(": connected\n\n");

      const writeEvent = (event: { id?: string | undefined; type: string }) => {
        const id = typeof event.id === "string" ? `id: ${event.id}\n` : "";
        response.write(
          `${id}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        );
      };

      // Subscribe before replaying so no event can slip through the gap.
      const buffered: Parameters<typeof writeEvent>[0][] = [];
      let streaming = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      let unsubscribe: () => void = () => {};

      const finish = () => {
        if (closed) {
          return;
        }

        closed = true;

        if (heartbeat) {
          clearInterval(heartbeat);
        }

        unsubscribe();
        response.end();
      };

      unsubscribe = deps.events.subscribe(request.params.runId, (event) => {
        if (!streaming) {
          buffered.push(event);
          return;
        }

        writeEvent(event);

        if (event.type === "run.completed" || event.type === "run.failed") {
          finish();
        }
      });

      const seen = new Set<string>();

      for (const event of await deps.store.listRunEvents(request.params.runId)) {
        seen.add(event.id);
        writeEvent(eventToDto(event));
      }

      streaming = true;

      let reachedTerminal = run.status !== "running";

      for (const event of buffered) {
        if (typeof event.id === "string" && seen.has(event.id)) {
          continue;
        }

        writeEvent(event);
        reachedTerminal ||=
          event.type === "run.completed" || event.type === "run.failed";
      }

      if (reachedTerminal) {
        finish();
        return;
      }

      heartbeat = setInterval(() => {
        response.write(": ping\n\n");
      }, 15_000);

      request.raw.on("close", () => {
        if (heartbeat) {
          clearInterval(heartbeat);
        }

        unsubscribe();
      });
    }
  );

  // Backwards-compatible synchronous endpoint kept from the first milestone.
  app.post("/research", async (request, reply) => {
    const parsed = researchRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    try {
      const { task, run, result } = await deps.runService.runToCompletion({
        prompt: parsed.data.input,
        agentId: parsed.data.agentId,
      });

      if (result.status === "failed") {
        request.log.error(
          { error: result.error },
          "Research agent execution failed"
        );

        return reply.status(500).send({
          success: false,
          error: result.error?.message ?? "Research agent execution failed.",
          result,
        });
      }

      return reply.send({
        success: true,
        taskId: task.id,
        runId: run.id,
        agentId: parsed.data.agentId,
        result,
      });
    } catch (error: unknown) {
      if (error instanceof UnknownAgentError) {
        return reply.status(404).send({
          success: false,
          error: error.message,
        });
      }

      throw error;
    }
  });
}

function toStartRequest(data: {
  prompt: string;
  title?: string | undefined;
  agentId: string;
  priority: string;
}): StartTaskRequest {
  return {
    prompt: data.prompt,
    agentId: data.agentId,
    priority: data.priority,
    ...(data.title ? { title: data.title } : {}),
  };
}
