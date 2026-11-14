import { LLMError } from "./types.js";

export interface PostJsonOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal JSON-over-HTTP helper used by the LLM adapters. Keeps retries,
 * timeouts and error normalisation in one place instead of duplicating them
 * per provider.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: PostJsonOptions
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = Math.max(1, (options.retries ?? 1) + 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new LLMError("LLM request was cancelled.", "LLM_CANCELLED");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");

        if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
          await sleep(250 * attempt);
          continue;
        }

        throw new LLMError(
          `LLM provider responded ${response.status}: ${detail.slice(0, 300)}`,
          "LLM_HTTP_ERROR",
          response.status
        );
      }

      return (await response.json()) as unknown;
    } catch (error: unknown) {
      if (error instanceof LLMError) {
        throw error;
      }

      const cancelled = options.signal?.aborted === true;

      if (cancelled) {
        throw new LLMError("LLM request was cancelled.", "LLM_CANCELLED");
      }

      if (attempt === attempts) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new LLMError(
            `LLM provider request timed out after ${options.timeoutMs}ms`,
            "LLM_TIMEOUT"
          );
        }

        throw new LLMError(
          error instanceof Error ? error.message : "LLM provider request failed",
          "LLM_REQUEST_FAILED"
        );
      }

      await sleep(250 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new LLMError("LLM provider request failed", "LLM_REQUEST_FAILED");
}
