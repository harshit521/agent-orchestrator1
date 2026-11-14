import type { RunEvent, Task } from "../types";

interface KanbanBoardProps {
  tasks: Task[];
  selectedId: string | null;
  liveEvents: Record<string, RunEvent[]>;
  onSelect: (taskId: string) => void;
}

const COLUMNS = [
  {
    id: "running",
    title: "Working",
    hint: "Agents executing now",
    dot: "bg-sky-400",
    ring: "border-sky-400/25",
  },
  {
    id: "failed",
    title: "Needs Attention",
    hint: "Runs that failed",
    dot: "bg-rose-400",
    ring: "border-rose-400/25",
  },
  {
    id: "in_review",
    title: "In Review",
    hint: "Awaiting human or CI review",
    dot: "bg-amber-300",
    ring: "border-amber-300/25",
  },
  {
    id: "completed",
    title: "Completed",
    hint: "Finished runs",
    dot: "bg-emerald-400",
    ring: "border-emerald-400/25",
  },
] as const;

function latestPercent(task: Task, liveEvents: Record<string, RunEvent[]>): number {
  const run = task.runs[0];

  if (!run) {
    return 0;
  }

  if (run.status === "completed" || run.status === "failed") {
    return 100;
  }

  const events = liveEvents[run.id] ?? [];
  const withPercent = [...events]
    .reverse()
    .find((event) => typeof event.percent === "number");

  return withPercent?.percent ?? 0;
}

function latestMessage(
  task: Task,
  liveEvents: Record<string, RunEvent[]>
): string | null {
  const run = task.runs[0];

  if (!run) {
    return null;
  }

  const events = liveEvents[run.id] ?? [];

  return events.at(-1)?.message ?? null;
}

function TaskCard({
  task,
  active,
  percent,
  message,
  onSelect,
}: {
  task: Task;
  active: boolean;
  percent: number;
  message: string | null;
  onSelect: () => void;
}) {
  const run = task.runs[0];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full rounded-xl border bg-slate-900/60 p-4 text-left transition hover:border-slate-600 hover:bg-slate-900 ${
        active ? "border-sky-400/60 ring-1 ring-sky-400/20" : "border-slate-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 text-sm font-medium text-slate-100">
          {task.title}
        </p>
        {run?.status === "running" ? (
          <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
        <span className="rounded-md bg-slate-800/80 px-1.5 py-0.5 font-mono">
          {task.agentId}
        </span>
        <span>·</span>
        <span>{new Date(task.createdAt).toLocaleTimeString()}</span>
      </div>

      {run?.status === "running" ? (
        <div className="mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-sky-400 transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          {message ? (
            <p className="mt-2 truncate text-[11px] text-slate-500">{message}</p>
          ) : null}
        </div>
      ) : null}

      {run && run.status !== "running" && run.durationMs !== null ? (
        <p className="mt-3 font-mono text-[11px] text-slate-500">
          {run.errorCode ? `${run.errorCode} · ` : ""}
          {run.durationMs}ms
        </p>
      ) : null}
    </button>
  );
}

export function KanbanBoard({
  tasks,
  selectedId,
  liveEvents,
  onSelect,
}: KanbanBoardProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      {COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column.id);

        return (
          <section
            key={column.id}
            className={`flex flex-col rounded-2xl border bg-slate-950/30 ${column.ring}`}
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-800/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${column.dot}`} />
                <h2 className="text-sm font-semibold text-slate-200">
                  {column.title}
                </h2>
              </div>
              <span className="rounded-full bg-slate-800/80 px-2 py-0.5 font-mono text-[11px] text-slate-400">
                {columnTasks.length}
              </span>
            </header>

            <p className="px-4 pt-2 text-[11px] text-slate-600">{column.hint}</p>

            <div className="flex flex-1 flex-col gap-3 p-3">
              {columnTasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-800 px-3 py-8 text-center text-xs text-slate-600">
                  Nothing here yet
                </p>
              ) : (
                columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    active={task.id === selectedId}
                    percent={latestPercent(task, liveEvents)}
                    message={latestMessage(task, liveEvents)}
                    onSelect={() => onSelect(task.id)}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
