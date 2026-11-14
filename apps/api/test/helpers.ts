import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig } from "../src/config.js";

const API_ROOT = fileURLToPath(new URL("../", import.meta.url));

export function testConfig(
  databaseUrl = "file:./data/test.db"
): AppConfig {
  return {
    nodeEnv: "test",
    port: 0,
    host: "127.0.0.1",
    databaseUrl,
    llm: {
      provider: "stub",
      maxTokens: 256,
      timeoutMs: 5_000,
    },
    github: {},
    worktrees: { enabled: false },
    security: { enabled: false },
  };
}

export interface TestDatabase {
  config: AppConfig;
  cleanup: () => void;
}

/**
 * Creates a throwaway SQLite database with the Prisma schema applied.
 * Using the real schema keeps integration tests honest.
 */
export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(path.join(tmpdir(), "taskfleet-test-"));
  const databaseUrl = `file:${path.join(directory, "test.db")}`;

  try {
    execFileSync("npx", ["prisma", "db", "push"], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`Failed to prepare the test database: ${stderr}`);
  }

  return {
    config: testConfig(databaseUrl),
    cleanup: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
