import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createTask,
  getTask,
  listAgents,
  listTasks,
  runEventStreamUrl,
} from "./api";
import { KanbanBoard } from "./components/KanbanBoard";
import { TaskDetail } from "./components/TaskDetail";
import { TaskForm } from "./components/TaskForm";
import type { AgentSummary, RunEvent, Task } from "./types";

const EVENT_TYPES = [
  "run.started",
  "run.progress",
  "run.completed",
  "run.failed",
] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

export default function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Task | null>(null);
  const [liveEvents, setLiveEvents] = useState<Record<string, RunEvent[]>>({});
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await listTasks();
      setTasks(data.tasks);
    } catch (cause: unknown) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2_500);

    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    void listAgents()
      .then((data) => setAgents(data.agents))
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, []);

  // Live SSE streams for every running run on the board.
  const runningRunIds = useMemo(
    () =>
      tasks.flatMap((task) =>
        task.runs.filter((run) => run.status === "running").map((run) => run.id)
      ),
    [tasks]
  );
  const runningKey = runningRunIds.join(",");

  useEffect(() => {
    const runIds = runningKey ? runningKey.split(",") : [];

    const sources = runIds.map((runId) => {
      const source = new EventSource(runEventStreamUrl(runId));

      const handleEvent = (event: Event) => {
        try {
          const parsed = JSON.parse(
            (event as MessageEvent<string>).data
          ) as RunEvent;

          setLiveEvents((previous) => {
            const existing = previous[runId] ?? [];

            if (parsed.id && existing.some((item) => item.id === parsed.id)) {
              return previous;
            }

            return {
              ...previous,
              [runId]: [...existing, parsed].slice(-100),
            };
          });

          if (
            parsed.type === "run.completed" ||
            parsed.type === "run.failed"
          ) {
            source.close();
            void refresh();
          }
        } catch {
          // Ignore keep-alive comments and malformed frames.
        }
      };

      for (const type of EVENT_TYPES) {
        source.addEventListener(type, handleEvent);
      }

      source.onopen = () =>
        setConnected((previous) => ({ ...previous, [runId]: true }));
      source.onerror = () =>
        setConnected((previous) => ({ ...previous, [runId]: false }));

      return source;
    });

    return () => {
      for (const source of sources) {
        source.close();
      }
    };
  }, [runningKey, refresh]);

  // Task detail is fetched separately because it includes the event log.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const data = await getTask(selectedId);

        if (!cancelled) {
          setDetail(data.task);
        }
      } catch (cause: unknown) {
        if (!cancelled) {
          setError(messageOf(cause));
        }
      }
    };

    void load();
    const timer = setInterval(() => void load(), 3_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId]);

  const selectedTask = useMemo(() => {
    if (!selectedId) {
      return null;
    }

    return detail?.id === selectedId
      ? detail
      : (tasks.find((task) => task.id === selectedId) ?? null);
  }, [detail, selectedId, tasks]);

  const selectedEvents = useMemo(() => {
    const run = selectedTask?.runs[0];

    if (!run) {
      return [];
    }

    const persisted = run.events ?? [];
    const live = liveEvents[run.id] ?? [];
    const seen = new Set(persisted.map((event) => event.id));

    return [...persisted, ...live.filter((event) => !seen.has(event.id))].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt)
    );
  }, [selectedTask, liveEvents]);

  async function handleCreate(prompt: string, agentId: string) {
    setBusy(true);
    setError(null);

    try {
      const data = await createTask(prompt, agentId);
      setSelectedId(data.task.id);
      await refresh();
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  const workingCount = tasks.filter((task) => task.status === "running").length;
  const attentionCount = tasks.filter((task) => task.status === "failed").length;
  const liveStreams = runningRunIds.filter((runId) => connected[runId]).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800/70 bg-slate-950/40 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-violet-500 font-bold text-slate-950">
              TF
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-50">
                TaskFleet
              </h1>
              <p className="text-xs text-slate-500">
                Multi-agent DevOps orchestrator
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-slate-400">
              {tasks.length} tasks
            </span>
            <span className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-1.5 text-sky-300">
              {workingCount} working
            </span>
            <span className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-rose-300">
              {attentionCount} need attention
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-slate-400">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  liveStreams > 0 ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                }`}
              />
              {liveStreams > 0
                ? `Live · ${liveStreams} stream${liveStreams === 1 ? "" : "s"}`
                : "Idle"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-6 py-6">
        <TaskForm agents={agents} busy={busy} onCreate={handleCreate} />

        {error ? (
          <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3">
            <p className="text-sm text-rose-200">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs text-rose-300/80 hover:text-rose-200"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div
          className={`mt-6 grid gap-6 ${
            selectedTask ? "xl:grid-cols-[minmax(0,1fr)_420px]" : ""
          }`}
        >
          <KanbanBoard
            tasks={tasks}
            selectedId={selectedId}
            liveEvents={liveEvents}
            onSelect={setSelectedId}
          />

          {selectedTask ? (
            <TaskDetail
              task={selectedTask}
              events={selectedEvents}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </main>

      <footer className="mx-auto max-w-[1680px] px-6 pb-8">
        <p className="border-t border-slate-800/60 pt-4 text-[11px] text-slate-600">
          TaskFleet · isolated workers · SSE progress · pluggable agents
        </p>
      </footer>
    </div>
  );
}
