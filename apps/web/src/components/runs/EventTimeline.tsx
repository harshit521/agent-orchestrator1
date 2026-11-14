import { formatTime } from "../../lib/format";
import { cn } from "../../lib/cn";
import type { RunEvent } from "../../types";
import { JsonBlock } from "../shared/JsonBlock";
import { Badge, type BadgeTone } from "../ui/Badge";

const TONES: Record<string, BadgeTone> = {
  "run.started": "info",
  "workspace.created": "accent",
  "workspace.removed": "neutral",
  "agent.started": "accent",
  "agent.edit": "warning",
  "run.progress": "neutral",
  "agent.progress": "neutral",
  "test.started": "info",
  "test.completed": "info",
  "git.commit": "success",
  "git.push": "success",
  "github.pr.opened": "success",
  "github.pr.skipped": "warning",
  "agent.completed": "success",
  "agent.failed": "danger",
  "run.completed": "success",
  "run.failed": "danger",
};

const DOTS: Record<BadgeTone, string> = {
  neutral: "bg-line-strong",
  accent: "bg-accent",
  success: "bg-ok",
  warning: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

export function EventTimeline({
  events,
  className,
  showData = true,
}: {
  events: RunEvent[];
  className?: string;
  showData?: boolean;
}) {
  if (events.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted">
        No events recorded for this run yet.
      </p>
    );
  }

  return (
    <ol className={cn("relative", className)}>
      {events.map((event, index) => {
        const tone = TONES[event.type] ?? "neutral";
        const isLast = index === events.length - 1;

        return (
          <li key={event.id} className="relative flex gap-3 px-4 py-2.5">
            {!isLast ? (
              <span
                aria-hidden="true"
                className="absolute top-7 bottom-0 left-[22px] w-px bg-line"
              />
            ) : null}
            <span className="relative z-10 mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
              <span className={cn("h-2 w-2 rounded-full", DOTS[tone])} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <code className="font-mono text-[11px] text-fg">
                  {event.type}
                </code>
                {event.percent !== null ? (
                  <span className="font-mono text-[10px] text-muted tabular-nums">
                    {event.percent}%
                  </span>
                ) : null}
                {event.stage && event.stage !== event.type ? (
                  <Badge tone="neutral">{event.stage}</Badge>
                ) : null}
                <time
                  dateTime={event.createdAt}
                  className="ml-auto font-mono text-[10px] text-muted tabular-nums"
                >
                  {formatTime(event.createdAt)}
                </time>
              </div>
              <p className="mt-0.5 text-xs leading-5 break-words text-muted">
                {event.message}
              </p>
              {showData && event.data !== null && event.data !== undefined ? (
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-muted transition-colors hover:text-fg">
                    <span className="group-open:hidden">Show event data</span>
                    <span className="hidden group-open:inline">Hide event data</span>
                  </summary>
                  <div className="mt-1.5">
                    <JsonBlock value={event.data} label="data" maxHeight="max-h-40" />
                  </div>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function latestEvent(events: RunEvent[]): RunEvent | null {
  return events.length > 0 ? (events[events.length - 1] ?? null) : null;
}

export function progressOf(events: RunEvent[]): number | null {
  let progress: number | null = null;

  for (const event of events) {
    if (event.percent !== null) {
      progress = Math.max(progress ?? 0, event.percent);
    }
  }

  return progress;
}
