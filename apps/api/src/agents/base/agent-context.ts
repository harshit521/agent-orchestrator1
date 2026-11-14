import type { AgentResult } from "./agent-result.js";
import type { ProgressReporter } from "./agent-input.js";

export interface AgentWorkspace {
  path: string;
  branch: string;
  taskId: string;
  runId: string;
}

export interface AgentContext {
  taskId: string;
  runId: string;

  originalPrompt: string;

  // Results from agents that have already executed.
  previousResults: Record<string, AgentResult>;

  // Present when the agent needs an isolated repository checkout.
  workspace?: AgentWorkspace;

  // Cooperative cancellation for provider calls and child processes.
  signal?: AbortSignal;

  // Optional metadata for this execution.
  metadata?: Record<string, unknown>;

  // Reports fine-grained execution progress to the orchestrator.
  reportProgress?: ProgressReporter;
}
