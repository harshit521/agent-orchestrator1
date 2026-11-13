import type { AgentContext } from "./agent-context";
import type { AgentResult } from "./agent-result";

export interface Agent {
  id: string;
  name: string;
  description?: string;

  execute(context: AgentContext): Promise<AgentResult>;
}