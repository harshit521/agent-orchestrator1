
import type { AgentContext } from "./agent-context.js";
import type { AgentResult } from "./agent-result.js";

export interface AgentInput {
  prompt: string;
  data?: unknown;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];

  run(
    input: AgentInput,
    context: AgentContext
  ): Promise<AgentResult>;
}
