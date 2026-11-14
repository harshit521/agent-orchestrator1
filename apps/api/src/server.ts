import { buildApp } from "./app.js";

const DEFAULT_PORT = 3000;

function resolvePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "", 10);

  return Number.isInteger(port) && port >= 0 ? port : DEFAULT_PORT;
}

const app = buildApp();

const start = async () => {
  try {
    await app.listen({
      port: resolvePort(process.env.PORT),
      host: process.env.HOST ?? "127.0.0.1",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Failed to shut down cleanly");
    process.exit(1);
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void start();
