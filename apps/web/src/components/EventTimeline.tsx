import type { RunEvent } from "../types";

const DOT: Record<string, string> = {
  "run.started": "bg-sky-400",
  "run.progress": "bg-slate-400",
  "run.completed": "bg-emerald-400",
  "run.failed": "bg-rose-400",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function EventTimeline({ events }: { events: RunEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700/70 px-4 py-6 text-center text-sm text-slate-500">
        Waiting for events from the worker…
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((event, index) => (
        <li key={event.id ?? `${event.type}-${index}`} className="flex gap-3">
          <div className="flex flex-col items-center pt-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                DOT[event.type] ?? "bg-slate-500"
              }`}
            />
            {index < events.length - 1 ? (
              <span className="mt-1 w-px flex-1 bg-slate-700/70" />
            ) : null}
          </div>

          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] tracking-wide text-slate-500 uppercase">
                {event.stage ?? event.type}
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {formatTime(event.createdAt)}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-300">{event.message}</p>
            {event.percent !== null ? (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-sky-400/80 transition-all duration-500"
                    style={{ width: `${event.percent}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-slate-500">
                  {event.percent}%
                </span>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
