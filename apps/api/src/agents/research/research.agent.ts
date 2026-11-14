import { z } from "zod";

import type { Agent, AgentInput } from "../base/agent.js";
import type { AgentContext } from "../base/agent-context.js";
import type { AgentResult } from "../base/agent-result.js";

const promptSchema = z.string().trim().min(1, "Prompt cannot be empty.");

export interface ResearchOutput {
  topic: string;
  summary: string;
  previousResultCount: number;
}

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
      const parsed = promptSchema.safeParse(input.prompt);

      if (!parsed.success) {
        return this.failure(
          "RESEARCH_AGENT_INVALID_PROMPT",
          parsed.error.issues[0]?.message ?? "Prompt cannot be empty.",
          startedAt
        );
      }

      const prompt = parsed.data;

      // Temporary implementation.
      // We'll replace this with an LLM call next.
      const output: ResearchOutput = {
        topic: prompt,
        summary: `Research task received: ${prompt}`,
        previousResultCount: Object.keys(context.previousResults).length,
      };

      return {
        agentId: this.id,
        status: "completed",
        output,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      };
    } catch (error: unknown) {
      return this.failure(
        "RESEARCH_AGENT_FAILED",
        error instanceof Error ? error.message : "An unknown error occurred.",
        startedAt
      );
    }
  }

  private failure(
    code: string,
    message: string,
    startedAt: Date
  ): AgentResult {
    return {
      agentId: this.id,
      status: "failed",
      error: { code, message },
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    };
  }
}
