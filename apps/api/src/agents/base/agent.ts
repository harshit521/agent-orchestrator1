import type { AgentContext } from "./agent-context.js";
import type { AgentInput } from "./agent-input.js";
import type { AgentResult } from "./agent-result.js";

export type { AgentInput, AgentProgress, ProgressReporter } from "./agent-input.js";
export type { AgentError, AgentResult, AgentStatus, AgentUsage } from "./agent-result.js";

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
