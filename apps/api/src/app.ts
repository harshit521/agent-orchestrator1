import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

import { createAgentRegistry } from "./agents/index.js";
import type { AgentRegistry } from "./agents/registry.js";
import { createPrismaClient } from "./db/client.js";
import { GitHubClient } from "./github/client.js";
import { registerGithubRoutes } from "./http/github-routes.js";
import { registerRoutes } from "./http/routes.js";
import { registerSecurityRoutes } from "./http/security-routes.js";
import { RunEventBus } from "./runs/event-bus.js";
import { RunService, type RunServiceDeps } from "./runs/run-service.js";
import { RunStore } from "./runs/run-store.js";
import { SchedulerService } from "./scheduler/SchedulerService.js";
import { SecurityScanner } from "./security/scanner.js";
import { WorktreeService } from "./worktrees/worktree-service.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface BuildAppOptions {
  /** Enable request logging. Disabled by default in tests. */
  logger?: boolean;
  /** Override the configuration, mainly for tests. */
  config?: AppConfig;
  /** Override the agent registry, mainly for tests. */
  agents?: AgentRegistry;
  /** Override the worktree service, mainly for tests. */
  worktreeService?: WorktreeService;
  /** Override GitHub wiring: null disables it, undefined uses configuration. */
  githubClient?: GitHubClient | null;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();

  // Create the Fastify app first
  const app = Fastify({
    logger: true,
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

  const prisma = createPrismaClient(config.databaseUrl);
  const store = new RunStore(prisma);
  const events = new RunEventBus();
  const agents =
    options.agents ?? createAgentRegistry(config.llm, config.agent);

  const worktreesRoot = config.worktrees.root
    ? path.resolve(REPO_ROOT, config.worktrees.root)
    : path.resolve(REPO_ROOT, ".taskfleet/worktrees");

  const worktreeService =
    options.worktreeService ??
    new WorktreeService({
      repoRoot: REPO_ROOT,
      worktreesRoot,
      authorName: config.git.authorName,
      authorEmail: config.git.authorEmail,
    });

  const configuredGithub: GitHubIntegration | null =
    config.github.token && config.github.repository
      ? {
          client: new GitHubClient({
            token: config.github.token,
            repository: config.github.repository,
          }),
          repository: config.github.repository,
          baseBranch: config.github.baseBranch,
          ...(config.github.remoteUrl
            ? { remoteUrl: config.github.remoteUrl }
            : {}),
        }
      : null;

  const github =
    options.githubClient === undefined
      ? configuredGithub
      : options.githubClient === null
        ? null
        : config.github.repository
          ? {
              client: options.githubClient,
              repository: config.github.repository,
              baseBranch: config.github.baseBranch,
              ...(config.github.remoteUrl
                ? { remoteUrl: config.github.remoteUrl }
                : {}),
            }
          : null;

  // Create the scheduler for managing run execution lifecycle
  const scheduler = new SchedulerService({
    store,
    events,
    config,
  });

  // Create the RunService with scheduler integration
  const lifecycle = new RunService({
    store,
    agents,
    events,
    logger: app.log,
    config,
    worktrees: {
      enabled: config.worktrees.enabled,
      service: worktreeService,
    },
    github,
    scheduler,
  });

  // Set up completion callbacks from RunService to scheduler
  lifecycle.registerCompletionCallback = (
    runId: string,
    callback: () => Promise<void>
  ) => {
    scheduler.registerCompletionCallback(runId, callback);
  };

  const apiDeps = {
    agents,
    store,
    events,
    runService: lifecycle,
    worktrees: {
      enabled: config.worktrees.enabled,
      service: worktreeService,
    },
    integrations: {
      llm: {
        provider: config.llm.provider,
        model: config.llm.model ?? null,
        configured:
          config.llm.provider === "stub" || Boolean(config.llm.apiKey),
        toolCalling: config.llm.provider !== "stub",
        live: config.llm.provider !== "stub",
      },
      github: {
        repository: config.github.repository ?? null,
        tokenConfigured: Boolean(config.github.token),
        webhookConfigured: Boolean(config.github.webhookSecret),
        prCreation: Boolean(github),
        baseBranch: config.github.baseBranch,
      },
      worktrees: {
        enabled: config.worktrees.enabled,
        root: worktreesRoot,
      },
      security: {
        enabled: config.security.enabled,
      },
    },
  };

  const securityDeps = {
    enabled: config.security.enabled,
    scanner: new SecurityScanner({ root: REPO_ROOT }),
  };

  // Canonical routes at the root (backwards compatible) and the same API
  // under /api so the SPA can use one base URL in dev and production.
  app.register(async (instance) => {
    registerRoutes(instance, apiDeps);
  });

  app.register(
    async (instance) => {
      registerRoutes(instance, apiDeps);
    },
    { prefix: "/api" }
  );

  app.register(
    async (instance) => {
      registerSecurityRoutes(instance, securityDeps);
    },
    { prefix: "/security" }
  );

  app.register(
    async (instance) => {
      registerSecurityRoutes(instance, securityDeps);
    },
    { prefix: "/api/security" }
  );

  // GitHub webhooks need the raw body for HMAC verification, so the parser is
  // scoped to this plugin instead of replacing the global JSON parser.
  app.register(
    async (instance) => {
      instance.addContentTypeParser(
        "application/json",
        { parseAs: "string" },
        (request: FastifyRequest, body: string, done) => {
          (request as FastifyRequest & { rawBody?: string }).rawBody = body;

          try {
            done(null, JSON.parse(body) as unknown);
          } catch (error: unknown) {
            done(
              error instanceof Error ? error : new Error("Invalid JSON body"),
              undefined
            );
          }
        }
      );

      registerGithubRoutes(instance, {
        store,
        ...(config.github.webhookSecret
          ? { secret: config.github.webhookSecret }
          : {}),
      });
    },
    { prefix: "/webhooks" }
  );

  // Serve the built dashboard when it exists (single-process demo / Docker).
  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, {
      root: WEB_DIST,
      wildcard: false,
      index: false,
    });

    app.setNotFoundHandler((request, reply) => {
      const wantsHtml =
        request.headers.accept?.includes("text/html") ?? false;

      if (
        request.method === "GET" &&
        wantsHtml &&
        !request.url.startsWith("/api")
      ) {
        return reply.sendFile("index.html");
      }

      return reply.status(404).send({ success: false, error: "Not found." });
    });
  }

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
    // Shut down the scheduler on app close
    await scheduler.shutdown();
  });

  // Handle restart recovery on startup
  // Run after the app is listening
  const startRecovery = async () => {
    try {
      // Re-identify orphaned runs and handle them appropriately
      await recoveryOnStartup(store, scheduler);
    } catch (error: unknown) {
      app.log.error({ err: error }, "Error during restart recovery");
    }
  };

  // Run recovery after a brief delay to let the app stabilize
  setTimeout(startRecovery, 1000);

  return app;
}

/**
 * Recovery on startup: identify orphaned runs and handle them appropriately.
 * - Running runs: mark as failed (they were interrupted)
 * - Queued runs: keep them queued for the scheduler to pick up
 * - Completed/failed/cancelled runs: leave as-is
 */
async function recoveryOnStartup(
  store: RunStore,
  scheduler: SchedulerService
): Promise<void> {
  // Find all runs that are in "running" state
  const runningRuns = await store.listRuns({ status: "running" });

  if (runningRuns.length === 0) {
    return;
  }

  // Mark all orphaned running runs as failed
  // These runs were interrupted by the restart, so we mark them as failed
  for (const run of runningRuns) {
    try {
      await store.completeRun(run.id, {
        status: "failed" as const,
        provider: null,
        model: null,
        completedAt: new Date(),
        durationMs: 0,
        inputTokens: null,
        outputTokens: null,
        output: null,
        error: {
          code: "INTERRUPTED_BY_RESTART",
          message: "Run was interrupted by application restart",
        },
      });

      // Publish failed event
      scheduler.publish({
        runId: run.id,
        taskId: run.taskId,
        type: "run.failed" as any,
        message: `Run ${run.id} failed (interrupted by restart)`,
        percent: 100,
        createdAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      // Skip on error
    }
  }

  // Process the queue to start any pending runs
  await scheduler.processQueue();
}