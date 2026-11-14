import { useEffect, useRef, useState } from "react";

import { runEventsUrl } from "../api";
import type { RunEvent, RunEventType } from "../types";

export type StreamState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "error";

const EVENT_TYPES: RunEventType[] = [
  "run.started",
  "agent.started",
  "run.progress",
  "agent.progress",
  "agent.completed",
  "agent.failed",
  "run.completed",
  "run.failed",
];

/**
 * Subscribes to the real SSE endpoint for a run. EventSource handles transient
 * network reconnects; the UI surfaces the connection state and lets the user
 * force a new subscription. Events are passed up for id-based de-duplication.
 */
export function useRunStream(
  runId: string | null,
  active: boolean,
  onEvent: (event: RunEvent) => void
): { state: StreamState; retry: () => void } {
  const [state, setState] = useState<StreamState>("idle");
  const [attempt, setAttempt] = useState(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!runId || !active) {
      setState("idle");
      return;
    }

    let source: EventSource;
    let disposed = false;
    let terminal = false;

    setState("connecting");
    source = new EventSource(runEventsUrl(runId));

    const handleEvent = (raw: Event) => {
      try {
        const event = JSON.parse((raw as MessageEvent<string>).data) as RunEvent;

        if (disposed) {
          return;
        }

        onEventRef.current(event);

        if (event.type === "run.completed" || event.type === "run.failed") {
          terminal = true;
          source.close();
          setState("closed");
        }
      } catch {
        // Ignore keep-alive comments and malformed frames.
      }
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, handleEvent);
    }

    source.onopen = () => {
      if (!disposed && !terminal) {
        setState("live");
      }
    };

    source.onerror = () => {
      if (disposed || terminal) {
        return;
      }

      if (source.readyState === EventSource.CLOSED) {
        setState("error");
      } else {
        setState("reconnecting");
      }
    };

    return () => {
      disposed = true;
      source.close();
    };
  }, [runId, active, attempt]);

  return {
    state,
    retry: () => setAttempt((value) => value + 1),
  };
}
