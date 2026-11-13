
import type { AgentResult } from "./agent-result.js";

export interface AgentContext {
  taskId: string;
  runId: string;

  originalPrompt: string;

  // Results from agents that have already executed.
  previousResults: Record<string, AgentResult>;

  // Optional metadata for this execution.
  metadata?: Record<string, unknown>;
}
