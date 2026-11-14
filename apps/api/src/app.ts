import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { createAgentRegistry } from "./agents/index.js";
import type { AgentContext } from "./agents/base/agent-context.js";
import type { AgentRegistry } from "./agents/registry.js";
import { researchRequestSchema } from "./http/research.schema.js";

export interface BuildAppOptions {
  /** Enable request logging. Disabled by default in tests. */
  logger?: boolean;
  /** Override the agent registry, mainly for tests. */
  agents?: AgentRegistry;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  const agents = options.agents ?? createAgentRegistry();

  app.get("/health", async () => ({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.post("/research", async (request, reply) => {
    const parsed = researchRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: "A valid input string is required.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { input, agentId } = parsed.data;
    const agent = agents.get(agentId);

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: `Unknown agent: ${agentId}`,
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

    const result = await agent.run({ prompt: input }, context);

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
      agentId: agent.id,
      result,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    let statusCode = 500;
    let message = "An unexpected error occurred.";

    if (error instanceof Error) {
      const maybeStatusCode = (error as { statusCode?: number }).statusCode;

      if (typeof maybeStatusCode === "number") {
        statusCode = maybeStatusCode;
      }

      if (statusCode < 500) {
        message = error.message;
      }
    }

    if (statusCode >= 500) {
      request.log.error({ err: error }, "Unhandled request error");
    } else {
      request.log.warn({ err: error }, "Request rejected");
    }

    return reply.status(statusCode).send({
      success: false,
      error: message,
    });
  });

  return app;
}
