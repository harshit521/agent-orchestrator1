import type { RunEventBus, RunEventType } from "../runs/event-bus.js";
import type { AppConfig } from "../config.js";
import type { RunStore } from "../runs/run-store.js";

export interface SchedulerDeps {
  store: RunStore;
  events: RunEventBus;
  config: AppConfig;
}

export class SchedulerService {
  readonly #store: RunStore;
  readonly #events: RunEventBus;
  readonly #config: AppConfig;
  readonly #maxConcurrent: number;
  #activeRuns = 0;
  #queue: Map<string, { taskId: string; priority: string }> = new Map();
  #processing = false;
  #shutdown = false;
  #executionCallbacks = new Map<string, () => Promise<void>>();
  #pollInterval: NodeJS.Timeout | null = null;

  constructor(deps: SchedulerDeps) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#config = deps.config;
    // Read MAX_CONCURRENT_RUNS from env, default to 3
    this.#maxConcurrent =
      process.env.MAX_CONCURRENT_RUNS !== undefined
        ? Number(process.env.MAX_CONCURRENT_RUNS)
        : 3;
    // Start polling for run completion
    this.#pollInterval = setInterval(() => this.#checkCompletedRuns(), 2000);
  }

  /**
   * Publish a run event to the event bus.
   * Can be used by external code (e.g., routes, other services).
   */
  publish(event: {
    runId: string;
    taskId: string;
    type: RunEventType;
    message: string;
    percent?: number;
    data?: unknown;
  }): void {
    const id = crypto.randomUUID();
    this.#events.publish({
      id,
      runId: event.runId,
      taskId: event.taskId,
      type: event.type,
      message: event.message,
      ...(event.percent !== undefined ? { percent: event.percent } : {}),
      ...(event.data !== undefined ? { data: event.data } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Submit a new run to the scheduler queue.
   * Atomically checks for duplicates and claims the run.
   */
  async submitRun(
    runId: string,
    taskId: string,
    agentId: string,
    priority: string = "medium"
  ): Promise<boolean> {
    // Check for duplicate execution - if run already exists in any terminal state, prevent duplicate
    const existing = await this.#store.findRunById(runId);
    if (existing) {
      if (existing.status === "running") {
        return false;
      }
      if (existing.status === "completed" || existing.status === "failed") {
        return false;
      }
      if (existing.status === "cancelled") {
        return false;
      }
    }

    // Check if already in queue
    if (this.#queue.has(runId)) {
      return false;
    }

    // Add to queue with priority
    this.#queue.set(runId, {
      taskId,
      priority,
    });
    this.#executionCallbacks.set(runId, async () => {});

    // Mark as queued in database
    await this.#store.updateRunStatus(runId, "queued");

    // Publish queued event
    this.publish({
      runId,
      taskId,
      type: "run.queued" as RunEventType,
      message: `Run ${runId} queued`,
      percent: 0,
    });

    // Try to start next run
    await this.processQueue();

    return true;
  }

  /**
   * Register a completion callback for a run.
   * The scheduler will call this when the run completes.
   */
  registerCompletionCallback(runId: string, callback: () => Promise<void>) {
    this.#executionCallbacks.set(runId, callback);
  }

  /**
   * Cancel a queued or running run.
   * Returns true if the run was successfully cancelled.
   */
  async cancelRun(runId: string): Promise<boolean> {
    // Check if run is in queue
    if (this.#queue.has(runId)) {
      const entry = this.#queue.get(runId);
      this.#queue.delete(runId);
      await this.#store.updateRunStatus(runId, "cancelled");

      // Publish cancelled event
      this.publish({
        runId,
        taskId: entry?.taskId ?? "",
        type: "run.cancelled" as RunEventType,
        message: `Run ${runId} cancelled`,
        percent: 100,
      });

      // Also cancel the execution callback if registered
      const callback = this.#executionCallbacks.get(runId);
      if (callback) {
        try {
          await callback();
        } catch {}
        this.#executionCallbacks.delete(runId);
      }

      return true;
    }

    // Check if run is running via store
    const runningRun = await this.#store.findRunById(runId);
    if (runningRun && runningRun.status === "running") {
      // Mark as cancelled in database
      await this.#store.updateRunStatus(runId, "cancelled");

      // Publish cancelled event
      this.publish({
        runId,
        taskId: runningRun.taskId ?? "",
        type: "run.cancelled" as RunEventType,
        message: `Run ${runId} cancelled`,
        percent: 100,
      });

      // Register cancellation via callback
      const callback = this.#executionCallbacks.get(runId);
      if (callback) {
        try {
          await callback();
        } catch {}
        this.#executionCallbacks.delete(runId);
      }

      return true;
    }

    return false;
  }

  /**
   * Process the queue: start up to MAX_CONCURRENT_RUNS runs.
   * Uses atomic database operations to claim runs.
   */
  async processQueue(): Promise<void> {
    if (this.#shutdown || this.#processing) {
      return;
    }

    // Start runs up to the concurrency limit
    while (this.#activeRuns < this.#maxConcurrent && this.#queue.size > 0) {
      // Get first run in queue (FIFO)
      const runId = this.#queue.keys().next().value;

      if (!runId) {
        break;
      }

      const entry = this.#queue.get(runId);
      if (!entry) {
        this.#queue.delete(runId);
        continue;
      }

      // Atomically claim the run - check it's still queued and claim it
      // by reading the status and updating it
      const isClaimed = await this.#tryClaimRun(runId);

      if (!isClaimed) {
        this.#queue.delete(runId);
        continue;
      }

      this.#activeRuns++;

      // Store the execution callback for this run
      const callback = async () => {
        await this.#simulateAndCompleteRun(runId);
      };
      this.#executionCallbacks.set(runId, callback);

      // Publish started event
      this.publish({
        runId,
        taskId: entry.taskId,
        type: "run.started" as RunEventType,
        message: `Run ${runId} started`,
        percent: 0,
      });
    }

    // Check again after a brief delay if there's still work
    if (this.#queue.size > 0 || this.#activeRuns > 0) {
      this.#processing = true;
      setTimeout(() => {
        this.#processing = false;
        this.processQueue();
      }, 1000);
    }
  }

  /**
   * Try to claim a run by checking its status and updating it to running.
   * Returns true if the run was successfully claimed (was queued, now marked running).
   */
  async #tryClaimRun(runId: string): Promise<boolean> {
    // Check if run is still queued
    const run = await this.#store.findRunById(runId);

    if (!run || run.status !== "queued") {
      return false;
    }

    // Mark as running
    await this.#store.updateRunStatus(runId, "running");

    return true;
  }

  /**
   * Simulate execution and complete the run.
   * In production, this would be replaced with actual RunService execution.
   */
  async #simulateAndCompleteRun(runId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.#markRunCompleted(runId);
  }

  async #markRunCompleted(runId: string): Promise<void> {
    const run = await this.#store.findRunById(runId);

    if (!run) {
      return;
    }

    await this.#store.completeRun(runId, {
      status: "completed" as const,
      provider: null,
      model: null,
      completedAt: new Date(),
      durationMs: 1000,
      inputTokens: null,
      outputTokens: null,
      output: null,
      error: null as { code?: string; message?: string } | null,
    });

    // Publish completed event
    this.publish({
      runId,
      taskId: run.taskId,
      type: "run.completed" as RunEventType,
      message: `Run ${runId} completed`,
      percent: 100,
      // @ts-ignore - type assertion for createdAt
      createdAt: new Date().toISOString(),
    });

    // Call the completion callback if registered
    const callback = this.#executionCallbacks.get(runId);
    if (callback) {
      try {
        await callback();
      } catch {}
      this.#executionCallbacks.delete(runId);
    }

    this.#activeRuns--;

    await this.processQueue();
  }

  async #markRunFailed(runId: string, error?: Error): Promise<void> {
    const run = await this.#store.findRunById(runId);

    if (!run) {
      return;
    }

    await this.#store.completeRun(runId, {
      status: "failed" as const,
      provider: null,
      model: null,
      completedAt: new Date(),
      durationMs: 1000,
      inputTokens: null,
      outputTokens: null,
      output: null,
      error: {
        code: error?.message ?? "EXECUTION_FAILED",
        message: error?.message ?? "Execution failed",
      } as { code: string; message: string } | null,
    });

    // Publish failed event
    this.publish({
      runId,
      taskId: run.taskId,
      type: "run.failed" as RunEventType,
      message: `Run ${runId} failed: ${error?.message ?? "unknown"}`,
      percent: 100,
    });

    // Call the completion callback if registered
    const callback = this.#executionCallbacks.get(runId);
    if (callback) {
      try {
        await callback();
      } catch {}
      this.#executionCallbacks.delete(runId);
    }

    this.#activeRuns--;

    await this.processQueue();
  }

  /**
   * Check for completed/failed/cancelled runs and process the next queued run.
   * Called periodically by the interval.
   */
  async #checkCompletedRuns(): Promise<void> {
    const activeRuns = await this.#store.listRuns({ status: "running" });

    for (const run of activeRuns) {
      const currentRun = await this.#store.findRunById(run.id);

      if (currentRun && currentRun.status !== "running") {
        this.#activeRuns--;
        await this.processQueue();
        return;
      }
    }

    if (activeRuns.length === 0 && this.#queue.size > 0) {
      // Queue has items but no active runs - processQueue will handle starting them
    }
  }

  async shutdown(): Promise<void> {
    this.#shutdown = true;
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = null;
    }
    await this.processQueue();
  }
}