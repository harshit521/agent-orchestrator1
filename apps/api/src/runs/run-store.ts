import type { AgentResult } from "../agents/base/agent-result.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { RunEventType } from "./event-bus.js";

export interface CreateTaskInput {
  title: string;
  prompt: string;
  agentId: string;
  priority: string;
}

export interface UpdateTaskInput {
  title?: string;
  prompt?: string;
  agentId?: string;
  priority?: string;
  status?: string;
}

export interface ListRunsOptions {
  limit?: number;
  status?: string;
  agentId?: string;
  taskId?: string;
}

export interface NewRunEvent {
  type: RunEventType;
  message: string;
  stage?: string;
  percent?: number;
  data?: unknown;
}

export interface AgentRunStats {
  agentId: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  activeRuns: number;
  lastStartedAt: string | null;
}

export interface TaskCounts {
  total: number;
  queued: number;
  running: number;
  inReview: number;
  completed: number;
  failed: number;
  readyToMerge: number;
}

export interface RunCounts {
  total: number;
  active: number;
  completed: number;
  failed: number;
}

const STATUS_TO_TASK_KEY: Record<string, keyof TaskCounts> = {
  queued: "queued",
  running: "running",
  in_review: "inReview",
  completed: "completed",
  failed: "failed",
  ready_to_merge: "readyToMerge",
};

const STATUS_TO_RUN_KEY: Record<string, keyof RunCounts> = {
  running: "active",
  completed: "completed",
  failed: "failed",
};

/**
 * Data-access layer for Task / Run / RunEvent. Kept deliberately thin: the
 * orchestration rules live in RunService, the SQL lives here.
 */
export class RunStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** Creates a queued task without executing it. */
  async createTask(input: CreateTaskInput) {
    return this.#prisma.task.create({
      data: {
        title: input.title,
        prompt: input.prompt,
        agentId: input.agentId,
        priority: input.priority,
        status: "queued",
      },
      include: { runs: { orderBy: { startedAt: "desc" } } },
    });
  }

  /** Creates a task and its first run in a single transaction. */
  async createTaskWithRun(input: CreateTaskInput) {
    const task = await this.#prisma.task.create({
      data: {
        title: input.title,
        prompt: input.prompt,
        agentId: input.agentId,
        priority: input.priority,
        status: "running",
        runs: {
          create: {
            agentId: input.agentId,
            status: "running",
          },
        },
      },
      include: { runs: { orderBy: { startedAt: "desc" } } },
    });

    const run = task.runs[0];

    if (!run) {
      throw new Error("Failed to create a run for the task.");
    }

    return { task, run };
  }

  /** Starts an additional run for an existing task. */
  async startRunForTask(taskId: string, agentId: string) {
    const task = await this.#prisma.task.update({
      where: { id: taskId },
      data: {
        status: "running",
        runs: {
          create: {
            agentId,
            status: "running",
          },
        },
      },
      include: { runs: { orderBy: { startedAt: "desc" } } },
    });

    const run = task.runs[0];

    if (!run) {
      throw new Error("Failed to create a run for the task.");
    }

    return { task, run };
  }

  async listTasks(limit = 200) {
    return this.#prisma.task.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        runs: { orderBy: { startedAt: "desc" } },
      },
    });
  }

  async getTask(id: string) {
    return this.#prisma.task.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          include: { events: { orderBy: { createdAt: "asc" } } },
        },
      },
    });
  }

  async updateTask(id: string, input: UpdateTaskInput) {
    return this.#prisma.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: { runs: { orderBy: { startedAt: "desc" } } },
    });
  }

  async deleteTask(id: string) {
    await this.#prisma.task.delete({ where: { id } });
  }

  async getRun(id: string) {
    return this.#prisma.run.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            prompt: true,
            status: true,
            priority: true,
            agentId: true,
          },
        },
        events: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async listRuns(options: ListRunsOptions = {}) {
    return this.#prisma.run.findMany({
      where: {
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: options.limit ?? 50,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            agentId: true,
          },
        },
      },
    });
  }

  async listRunEvents(runId: string) {
    return this.#prisma.runEvent.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Returns the most recent persisted events with their task context. */
  async listRecentActivity(limit = 20) {
    return this.#prisma.runEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        run: {
          select: {
            id: true,
            status: true,
            task: { select: { id: true, title: true } },
          },
        },
      },
    });
  }

  async appendEvent(runId: string, event: NewRunEvent) {
    return this.#prisma.runEvent.create({
      data: {
        runId,
        type: event.type,
        message: event.message,
        ...(event.stage ? { stage: event.stage } : {}),
        ...(event.percent !== undefined ? { percent: event.percent } : {}),
        ...(event.data !== undefined
          ? { data: JSON.stringify(event.data) }
          : {}),
      },
    });
  }

  async completeRun(runId: string, result: AgentResult) {
    return this.#prisma.run.update({
      where: { id: runId },
      data: {
        status: result.status,
        provider: result.provider ?? null,
        model: result.model ?? null,
        completedAt: new Date(result.completedAt),
        durationMs: result.durationMs,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        ...(result.output !== undefined
          ? { output: JSON.stringify(result.output) }
          : {}),
        ...(result.error
          ? {
              errorCode: result.error.code,
              errorMessage: result.error.message,
            }
          : {}),
      },
    });
  }

  async updateTaskStatus(taskId: string, status: string) {
    return this.#prisma.task.update({
      where: { id: taskId },
      data: { status },
    });
  }

  /** Aggregated dashboard counts, computed from persisted rows. */
  async getStats() {
    const [taskGroups, runGroups, activeRuns] = await Promise.all([
      this.#prisma.task.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.#prisma.run.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.#prisma.run.findMany({
        where: { status: "running" },
        orderBy: { startedAt: "desc" },
        take: 10,
        include: {
          task: {
            select: {
              id: true,
              title: true,
              priority: true,
              agentId: true,
            },
          },
        },
      }),
    ]);

    const tasks: TaskCounts = {
      total: 0,
      queued: 0,
      running: 0,
      inReview: 0,
      completed: 0,
      failed: 0,
      readyToMerge: 0,
    };

    for (const group of taskGroups) {
      const key = STATUS_TO_TASK_KEY[group.status];
      const count = group._count._all;

      tasks.total += count;

      if (key && key !== "total") {
        tasks[key] += count;
      }
    }

    const runs: RunCounts = {
      total: 0,
      active: 0,
      completed: 0,
      failed: 0,
    };

    for (const group of runGroups) {
      const count = group._count._all;
      runs.total += count;

      const key = STATUS_TO_RUN_KEY[group.status];

      if (key && key !== "total") {
        runs[key] += count;
      }
    }

    return { tasks, runs, activeRuns };
  }

  /**
   * Per-agent execution aggregates. Grouped by agent and status in one query
   * so the agents page stays accurate without N+1 queries.
   */
  async agentStats(agentId?: string): Promise<AgentRunStats[]> {
    const rows = await this.#prisma.run.groupBy({
      by: ["agentId", "status"],
      ...(agentId !== undefined ? { where: { agentId } } : {}),
      _count: { _all: true },
      _max: { startedAt: true },
    });

    const stats = new Map<string, AgentRunStats>();

    for (const row of rows) {
      const current = stats.get(row.agentId) ?? {
        agentId: row.agentId,
        totalRuns: 0,
        completedRuns: 0,
        failedRuns: 0,
        activeRuns: 0,
        lastStartedAt: null,
      };

      current.totalRuns += row._count._all;

      if (row.status === "completed") {
        current.completedRuns += row._count._all;
      } else if (row.status === "failed") {
        current.failedRuns += row._count._all;
      } else if (row.status === "running") {
        current.activeRuns += row._count._all;
      }

      const startedAt = row._max.startedAt?.toISOString() ?? null;

      if (startedAt && (!current.lastStartedAt || startedAt > current.lastStartedAt)) {
        current.lastStartedAt = startedAt;
      }

      stats.set(row.agentId, current);
    }

    return [...stats.values()];
  }
}
