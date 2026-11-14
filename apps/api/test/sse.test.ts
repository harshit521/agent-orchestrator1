import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";

import { buildApp } from "../src/app.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

describe("run event stream", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    db = createTestDatabase();
    app = buildApp({ logger: false, config: db.config });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    db.cleanup();
  });

  it("streams started, progress and completed events over SSE", async () => {
    const created = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Stream this run" }),
    });

    expect(created.status).toBe(202);

    const createdBody = (await created.json()) as {
      run: { id: string };
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(
        `${baseUrl}/runs/${createdBody.run.id}/events`,
        {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        }
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream"
      );
      expect(response.body).not.toBeNull();

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      while (!text.includes("event: run.completed")) {
        const chunk = await reader.read();

        if (chunk.done) {
          break;
        }

        text += decoder.decode(chunk.value, { stream: true });
      }

      expect(text).toContain("event: run.started");
      expect(text).toContain("event: agent.started");
      expect(text).toContain("event: agent.progress");
      expect(text).toContain("event: agent.completed");
      expect(text).toContain("event: run.completed");
      expect(text).toContain('"percent":20');
      expect(text).toContain('"percent":80');

      // The server ends the stream once the run reaches a terminal state.
      let ended = false;

      for (let attempt = 0; attempt < 50; attempt += 1) {
        const chunk = await reader.read();

        if (chunk.done) {
          ended = true;
          break;
        }
      }

      expect(ended).toBe(true);
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });
});
