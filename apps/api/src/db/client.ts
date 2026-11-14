import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client.js";

/**
 * `apps/api`, both from `src/db/client.ts` and `dist/db/client.js`.
 * Relative SQLite URLs are resolved against it so the API behaves the same
 * regardless of the directory it was started from.
 */
const API_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function resolveDatabaseUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  const rawPath = databaseUrl.slice("file:".length);

  if (rawPath === ":memory:" || path.isAbsolute(rawPath)) {
    return databaseUrl;
  }

  return `file:${path.resolve(API_ROOT, rawPath)}`;
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const resolvedUrl = resolveDatabaseUrl(databaseUrl);

  if (resolvedUrl.startsWith("file:")) {
    const filePath = resolvedUrl.slice("file:".length);

    if (filePath !== ":memory:") {
      mkdirSync(path.dirname(filePath), { recursive: true });
    }
  }

  const adapter = new PrismaBetterSqlite3({ url: resolvedUrl });

  return new PrismaClient({ adapter });
}
