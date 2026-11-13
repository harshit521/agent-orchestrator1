
import type { Agent, AgentInput } from "../base/agent.js";
import type { AgentContext } from "../base/agent-context.js";
import type { AgentResult } from "../base/agent-result.js";

export class ResearchAgent implements Agent {
  readonly id = "research-agent";
  readonly name = "Research Agent";
  readonly description =
    "Analyzes a prompt and produces a preliminary research summary.";
  readonly capabilities = ["research", "summarization", "analysis"];

  async run(
    input: AgentInput,
    context: AgentContext
  ): Promise<AgentResult> {
    const startedAt = new Date();

    try {
      const prompt = input.prompt.trim();

      if (!prompt) {
        throw new Error("Prompt cannot be empty.");
      }

      // Temporary implementation.
      // We'll replace this with an LLM call next.
      const output = {
        topic: prompt,
        summary: `Research task received: ${prompt}`,
        previousResultCount: Object.keys(context.previousResults).length,
      };

      const completedAt = new Date();

      return {
        agentId: this.id,
        status: "completed",
        output,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    } catch (error: unknown) {
      const completedAt = new Date();

      return {
        agentId: this.id,
        status: "failed",
        error: {
          code: "RESEARCH_AGENT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "An unknown error occurred.",
        },
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    }
  }
}
