import { z } from "zod";

import type { Agent, AgentInput } from "../base/agent.js";
import type { AgentContext } from "../base/agent-context.js";
import type { AgentResult } from "../base/agent-result.js";
import { LLMError, type LLMProvider } from "../../llm/types.js";

const promptSchema = z.string().trim().min(1, "Prompt cannot be empty.");

const SYSTEM_PROMPT = [
  "You are the TaskFleet research agent.",
  "Given a software engineering task, produce a concise research summary:",
  "the core problem, the relevant concepts or files, and a suggested plan.",
  "Answer in plain text of at most 250 words.",
].join(" ");

export interface ResearchOutput {
  topic: string;
  summary: string;
  provider: string;
  model: string;
  previousResultCount: number;
}

export class ResearchAgent implements Agent {
  readonly id = "research-agent";
  readonly name = "Research Agent";
  readonly description =
    "Analyzes a prompt and produces a preliminary research summary.";
  readonly capabilities = ["research", "summarization", "analysis"];
  readonly providerId: string;
  readonly model: string;

  readonly #provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.#provider = provider;
    this.providerId = provider.id;
    this.model = provider.defaultModel;
  }

  async run(
    input: AgentInput,
    context: AgentContext
  ): Promise<AgentResult> {
    const startedAt = new Date();
    const report = context.reportProgress;

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

      report?.({
        stage: "llm.request",
        message: `Calling ${this.#provider.id} (${this.#provider.defaultModel})`,
        percent: 20,
      });

      const response = await this.#provider.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      report?.({
        stage: "llm.response",
        message: `Received ${response.text.length} characters from ${response.provider}`,
        percent: 80,
      });

      const output: ResearchOutput = {
        topic: prompt,
        summary: response.text,
        provider: response.provider,
        model: response.model,
        previousResultCount: Object.keys(context.previousResults).length,
      };

      return {
        agentId: this.id,
        status: "completed",
        output,
        provider: response.provider,
        model: response.model,
        ...(response.usage ? { usage: response.usage } : {}),
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      };
    } catch (error: unknown) {
      const code =
        error instanceof LLMError ? error.code : "RESEARCH_AGENT_FAILED";
      const message =
        error instanceof Error ? error.message : "An unknown error occurred.";

      return this.failure(code, message, startedAt);
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
