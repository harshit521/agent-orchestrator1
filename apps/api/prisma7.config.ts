import { defineConfig } from "prisma/config";

// Load .env with Node's built-in loader when available so the CLI sees the
// same configuration as the runtime. Missing files are ignored.
try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {
  // No .env file: fall back to the process environment and defaults.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "file:./data/taskfleet.db",
  },
});
