import { useCallback, useEffect, useRef, useState } from "react";

export interface UseQueryOptions {
  enabled?: boolean;
  refreshInterval?: number;
  initialData?: unknown;
}

export interface QueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  refetch: () => void;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

/**
 * Small keyed query hook. It keeps the UI honest: errors are surfaced instead
 * of being replaced with placeholder data, and polling only refreshes data
 * that was already fetched.
 */
export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: UseQueryOptions = {}
): QueryResult<T> {
  const { enabled = true, refreshInterval, initialData } = options;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [data, setData] = useState<T | null>(
    (initialData as T | undefined) ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(
    async (background: boolean) => {
      if (!enabled) {
        return;
      }

      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const result = await fetcherRef.current();
        setData(result);
        setError(null);
      } catch (cause: unknown) {
        setError(messageOf(cause));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void run(false);
  }, [key, enabled, run]);

  useEffect(() => {
    if (!enabled || !refreshInterval) {
      return;
    }

    const timer = setInterval(() => void run(true), refreshInterval);

    return () => clearInterval(timer);
  }, [enabled, refreshInterval, run]);

  const refetch = useCallback(() => {
    void run(true);
  }, [run]);

  return { data, error, loading, refreshing, refetch };
}
