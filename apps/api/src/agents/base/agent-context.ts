export interface AgentContext {
  taskId: string;
  input: string;
  metadata?: Record<string, unknown>;
}