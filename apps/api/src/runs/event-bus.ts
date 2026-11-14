import { EventEmitter } from "node:events";

export type RunEventType =
  | "run.started"
  | "agent.started"
  | "run.progress"
  | "agent.progress"
  | "agent.completed"
  | "agent.failed"
  | "run.completed"
  | "run.failed";

export interface RunEvent {
  id?: string;
  runId: string;
  taskId: string;
  type: RunEventType;
  stage?: string;
  message: string;
  percent?: number;
  data?: unknown;
  createdAt: string;
}

/**
 * In-process pub/sub for run events. SSE subscribers attach per run, so
 * multiple browser tabs can watch the same execution.
 */
export class RunEventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(0);
  }

  publish(event: RunEvent): void {
    this.#emitter.emit(event.runId, event);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.#emitter.on(runId, listener);

    return () => {
      this.#emitter.off(runId, listener);
    };
  }
}
