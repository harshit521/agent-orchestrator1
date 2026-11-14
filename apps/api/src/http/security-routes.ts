import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { SecurityScanner } from "../security/scanner.js";

const scanRequestSchema = z.object({
  path: z.string().trim().min(1).optional(),
});

export interface SecurityRouteOptions {
  scanner: SecurityScanner;
  enabled: boolean;
}

export function registerSecurityRoutes(
  app: FastifyInstance,
  options: SecurityRouteOptions
): void {
  app.get("/tools", async () => ({
    success: true,
    enabled: options.enabled,
    root: options.scanner.root,
    tools: await options.scanner.availability(),
  }));

  app.post("/scan", async (request, reply) => {
    if (!options.enabled) {
      return reply.status(503).send({
        success: false,
        error: "Security scanning is disabled. Set SECURITY_ENABLED=true.",
      });
    }

    const parsed = scanRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: "Invalid scan request.",
      });
    }

    let target: string;

    try {
      target = options.scanner.resolveTarget(parsed.data.path ?? ".");
    } catch (error: unknown) {
      return reply.status(400).send({
        success: false,
        error:
          error instanceof Error ? error.message : "Invalid scan target.",
      });
    }

    const results = await options.scanner.scan(
      parsed.data.path ?? "."
    );

    const failed = results.some((result) => result.status === "failed");
    const errored = results.some((result) => result.status === "error");

    return {
      success: !failed && !errored,
      target,
      status: failed ? "failed" : errored ? "error" : "passed",
      results,
    };
  });
}
