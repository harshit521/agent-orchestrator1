import { buildApp } from "./app.js";
import { ConfigError, loadConfig, type AppConfig } from "./config.js";
import { loadEnvFile } from "./env.js";

function readConfig(): AppConfig {
  try {
    return loadConfig();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Invalid configuration.";

    console.error(
      error instanceof ConfigError ? message : `Configuration error: ${message}`
    );
    process.exit(1);
  }
}

loadEnvFile();

const config = readConfig();
const app = buildApp({ config });

const start = async () => {
  try {
    await app.listen({ port: config.port, host: config.host });
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
