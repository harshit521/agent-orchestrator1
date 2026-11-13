
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { ResearchAgent } from "./agents/research/research.agent.js";
import type { AgentContext } from "./agents/base/agent-context.js";

const app = Fastify({
  logger: true,
});

const researchAgent = new ResearchAgent();

app.post<{
  Body: {
    input: string;
  };
}>("/research", async (request, reply) => {
  try {
    const { input } = request.body ?? {};

    if (typeof input !== "string" || !input.trim()) {
      return reply.status(400).send({
        success: false,
        error: "A valid input string is required.",
      });
    }

    const taskId = randomUUID();
    const runId = randomUUID();

    const context: AgentContext = {
      taskId,
      runId,
      originalPrompt: input,
      previousResults: {},
    };

    const result = await researchAgent.run(
      { prompt: input },
      context
    );

    if (result.status === "failed") {
      request.log.error(
        { error: result.error },
        "Research agent execution failed"
      );

      return reply.status(500).send({
        success: false,
        error: result.error?.message ?? "Research agent execution failed.",
        result,
      });
    }

    return reply.send({
      success: true,
      taskId,
      runId,
      result,
    });
  } catch (error: unknown) {
    request.log.error({ err: error }, "Unexpected research API error");

    return reply.status(500).send({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
    });
  }
});

const start = async () => {
  try {
    await app.listen({
      port: Number(process.env.PORT) || 3000,
      host: "127.0.0.1",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
