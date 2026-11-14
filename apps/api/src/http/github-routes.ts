import type { FastifyInstance } from "fastify";

import { verifySignature } from "../github/signature.js";
import {
  handleGithubWebhook,
  type WebhookStore,
} from "../github/webhook.js";

export interface GithubRouteOptions {
  store: WebhookStore;
  secret?: string;
}

export function registerGithubRoutes(
  app: FastifyInstance,
  options: GithubRouteOptions
): void {
  app.post("/github", async (request, reply) => {
    if (!options.secret) {
      return reply.status(503).send({
        success: false,
        error:
          "GitHub webhooks are not configured. Set GITHUB_WEBHOOK_SECRET.",
      });
    }

    const signature = request.headers["x-hub-signature-256"];
    const rawBody = (request as { rawBody?: string }).rawBody;

    if (
      !rawBody ||
      typeof signature !== "string" ||
      !verifySignature(options.secret, rawBody, signature)
    ) {
      return reply.status(401).send({
        success: false,
        error: "Invalid webhook signature.",
      });
    }

    const event = request.headers["x-github-event"];

    if (typeof event !== "string") {
      return reply.status(400).send({
        success: false,
        error: "Missing x-github-event header.",
      });
    }

    const result = await handleGithubWebhook(event, request.body, options.store);

    return reply.status(202).send({ success: true, ...result });
  });
}
