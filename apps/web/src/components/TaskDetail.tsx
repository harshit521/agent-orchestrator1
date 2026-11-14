import { EventTimeline } from "./EventTimeline";
import { StatusBadge } from "./StatusBadge";
import type { RunEvent, Task } from "../types";

interface TaskDetailProps {
  task: Task;
  events: RunEvent[];
  onClose: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function summaryOf(output: unknown): string | null {
  if (!isRecord(output)) {
    return null;
  }

  return typeof output.summary === "string" ? output.summary : null;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-mono text-xs text-slate-300">
        {value}
      </dd>
    </div>
  );
}

export function TaskDetail({ task, events, onClose }: TaskDetailProps) {
  const run = task.runs[0];
  const summary = run ? summaryOf(run.output) : null;
  const lastPercent = [...events]
    .reverse()
    .find((event) => typeof event.percent === "number")?.percent;

  return (
    <aside className="h-fit rounded-2xl border border-slate-800 bg-slate-900/50 shadow-2xl shadow-black/20 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
      <header className="flex items-start justify-between gap-4 border-b border-slate-800/80 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
            Task detail
          </p>
          <h2 className="mt-1 text-sm font-semibold text-slate-100">
            {task.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-700/70 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
          aria-label="Close task detail"
        >
          Close
        </button>
      </header>

      <div className="space-y-5 px-5 py-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          {run?.provider ? (
            <span className="rounded-md bg-slate-800/80 px-2 py-0.5 font-mono text-[10px] text-slate-400">
              {run.provider}
              {run.model ? ` · ${run.model}` : ""}
            </span>
          ) : null}
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-medium tracking-wider text-slate-500 uppercase">
            Prompt
          </p>
          <p className="max-h-32 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
            {task.prompt}
          </p>
        </div>

        {run ? (
          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800/80 bg-slate-950/30 px-3 py-3">
            <MetaRow label="Agent" value={run.agentId} />
            <MetaRow
              label="Duration"
              value={
                run.durationMs !== null ? `${run.durationMs} ms` : "running…"
              }
            />
            <MetaRow
              label="Started"
              value={new Date(run.startedAt).toLocaleTimeString()}
            />
            <MetaRow label="Run" value={run.id.slice(-8)} />
          </dl>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
              Progress
            </p>
            <span className="font-mono text-[10px] text-slate-500">
              {lastPercent ?? 0}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                task.status === "failed" ? "bg-rose-400" : "bg-sky-400"
              }`}
              style={{ width: `${lastPercent ?? 0}%` }}
            />
          </div>
        </div>

        {run?.status === "failed" && run.errorMessage ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2.5">
            <p className="font-mono text-[10px] tracking-wider text-rose-400 uppercase">
              {run.errorCode ?? "Error"}
            </p>
            <p className="mt-1 text-xs text-rose-200">{run.errorMessage}</p>
          </div>
        ) : null}

        {summary ? (
          <div>
            <p className="mb-1.5 text-[10px] font-medium tracking-wider text-slate-500 uppercase">
              Agent output
            </p>
            <p className="max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
              {summary}
            </p>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-[10px] font-medium tracking-wider text-slate-500 uppercase">
            Execution log
          </p>
          <EventTimeline events={events} />
        </div>
      </div>
    </aside>
  );
}
