import type { AgentContext } from "./agent-context.js";
import type { AgentResult } from "./agent-result.js";

export interface AgentInput {
  prompt: string;
  data?: unknown;
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly string[];

  run(
    input: AgentInput,
    context: AgentContext
  ): Promise<AgentResult>;
}
