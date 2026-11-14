import type { AgentResult } from "../agents/base/agent-result.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { RunEventType } from "./event-bus.js";

export interface CreateTaskInput {
  title: string;
  prompt: string;
  agentId: string;
}

export interface NewRunEvent {
  type: RunEventType;
  message: string;
  stage?: string;
  percent?: number;
  data?: unknown;
}

/**
 * Data-access layer for Task / Run / RunEvent. Kept deliberately thin: the
 * orchestration rules live in RunService, the SQL lives here.
 */
export class RunStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async createTaskWithRun(input: CreateTaskInput) {
    const task = await this.#prisma.task.create({
      data: {
        title: input.title,
        prompt: input.prompt,
        agentId: input.agentId,
        status: "running",
        runs: {
          create: {
            agentId: input.agentId,
            status: "running",
          },
        },
      },
      include: { runs: true },
    });

    const run = task.runs[0];

    if (!run) {
      throw new Error("Failed to create a run for the task.");
    }

    return { task, run };
  }

  async listTasks(limit = 100) {
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

  async getRun(id: string) {
    return this.#prisma.run.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });
  }

  async listRunEvents(runId: string) {
    return this.#prisma.runEvent.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
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
}
