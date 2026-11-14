import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";

import type { AgentRegistry } from "../agents/registry.js";
import type { RunEventBus } from "../runs/event-bus.js";
import type { RunStore } from "../runs/run-store.js";
import type { WorktreeService } from "../worktrees/worktree-service.js";
import { eventToDto, runToDto } from "../runs/run-dto.js";
import {
  RunService,
  type StartTaskRequest,
  UnknownAgentError,
} from "../runs/run-service.js";
import { createTaskSchema, researchRequestSchema } from "./schemas.js";

export interface RouteDependencies {
  agents: AgentRegistry;
  store: RunStore;
  events: RunEventBus;
  runService: RunService;
  worktrees: {
    enabled: boolean;
    service: WorktreeService;
  };
}

function validationError(reply: FastifyReply, error: ZodError) {
  return reply.status(400).send({
    success: false,
    error: "Invalid request body.",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

export function registerRoutes(
  app: FastifyInstance,
  deps: RouteDependencies
): void {
  app.get("/health", async () => ({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/agents", async () => ({
    success: true,
    agents: deps.agents.list().map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
    })),
  }));

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
      const { task, run } = await deps.runService.startTask(
        toStartRequest(parsed.data)
      );

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
}): StartTaskRequest {
  return {
    prompt: data.prompt,
    agentId: data.agentId,
    ...(data.title ? { title: data.title } : {}),
  };
}
