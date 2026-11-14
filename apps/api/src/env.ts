/**
 * Loads `apps/api/.env` when present using Node's built-in loader, so the API
 * needs no dotenv dependency. Missing files are ignored; real environment
 * variables always win.
 */
export function loadEnvFile(
  url: URL = new URL("../.env", import.meta.url)
): void {
  try {
    process.loadEnvFile(url);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
