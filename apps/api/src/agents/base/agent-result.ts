
export type AgentStatus = "completed" | "failed";

export interface AgentResult {
  agentId: string;
  status: AgentStatus;

  output?: unknown;
  error?: {
    code: string;
    message: string;
  };

  startedAt: string;
  completedAt: string;
  durationMs: number;
}
