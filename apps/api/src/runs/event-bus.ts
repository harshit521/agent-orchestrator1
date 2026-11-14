import { EventEmitter } from "node:events";

export type RunEventType =
  | "run.started"
  | "workspace.created"
  | "workspace.removed"
  | "agent.started"
  | "agent.edit"
  | "run.progress"
  | "agent.progress"
  | "test.started"
  | "test.completed"
  | "git.commit"
  | "git.push"
  | "github.pr.opened"
  | "github.pr.skipped"
  | "agent.completed"
  | "agent.failed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

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
