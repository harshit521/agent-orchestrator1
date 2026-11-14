import { useMemo, useState } from "react";

import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import { messageOf } from "../lib/errors";
import { formatRelative, shortId, truncate } from "../lib/format";
import { hrefFor, navigate } from "../lib/router";
import type { Task, TaskStatus } from "../types";
import { TaskDialog } from "../components/tasks/TaskDialog";
import { PriorityBadge, StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/Dialog";
import { Input } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { PageHeader, Segmented } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";
import {
  EmptyState,
  ErrorState,
  InlineError,
  TableSkeleton,
} from "../components/ui/States";
import { useToast } from "../components/ui/Toast";

type StatusFilter = "all" | TaskStatus;

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; task: Task }
  | null;

export function TasksPage() {
  const tasks = useQuery("tasks", api.tasks.list, { refreshInterval: 5_000 });
  const agents = useQuery("agents", api.agents.list);
  const { toast } = useToast();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const allTasks = tasks.data?.tasks ?? [];

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      all: allTasks.length,
      queued: 0,
      running: 0,
      in_review: 0,
      completed: 0,
      failed: 0,
      ready_to_merge: 0,
    };

    for (const task of allTasks) {
      result[task.status] += 1;
    }

    return result;
  }, [allTasks]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return allTasks.filter((task) => {
      if (filter !== "all" && task.status !== filter) {
        return false;
      }

      if (!term) {
        return true;
      }

      return (
        task.title.toLowerCase().includes(term) ||
        task.prompt.toLowerCase().includes(term) ||
        task.id.toLowerCase().includes(term) ||
        task.agentId.toLowerCase().includes(term)
      );
    });
  }, [allTasks, filter, search]);

  async function submitTask(task: Task) {
    setRunningId(task.id);

    try {
      const response = await api.tasks.run(task.id);

      toast({
        title: "Run dispatched",
        description: `Task queued for ${task.agentId}.`,
        variant: "success",
      });

      if (response.run) {
        navigate(`/runs/${response.run.id}`);
      } else {
        tasks.refetch();
      }
    } catch (cause: unknown) {
      toast({
        title: "Could not start the run",
        description: messageOf(cause),
        variant: "error",
      });
    } finally {
      setRunningId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) {
      return;
    }

    setDeleteBusy(true);
    setDeleteError(null);

    try {
      await api.tasks.remove(deleting.id);
      toast({
        title: "Task deleted",
        description: "The task and its run history were removed.",
        variant: "success",
      });
      setDeleting(null);
      tasks.refetch();
    } catch (cause: unknown) {
      setDeleteError(messageOf(cause));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        description="Create, edit and dispatch work. Every row is a persisted task backed by the API."
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={tasks.refetch}
              loading={tasks.refreshing}
              leading={<Icon name="refresh" className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setDialog({ mode: "create" })}
              leading={<Icon name="plus" className="h-3.5 w-3.5" />}
            >
              New task
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, prompt, id or agent…"
            aria-label="Search tasks"
            className="pl-8"
          />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          ariaLabel="Filter tasks by status"
          options={STATUS_OPTIONS.map((option) => ({
            ...option,
            count: counts[option.value],
          }))}
        />
      </div>

      {tasks.error ? (
        <InlineError
          message={`${tasks.error} Showing the last loaded tasks.`}
          onRetry={tasks.refetch}
        />
      ) : null}

      <Panel>
        {tasks.loading && !tasks.data ? (
          <TableSkeleton rows={6} columns={6} />
        ) : tasks.error && !tasks.data ? (
          <div className="p-4">
            <ErrorState message={tasks.error} onRetry={tasks.refetch} />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                allTasks.length === 0
                  ? "No tasks yet"
                  : "No tasks match this view"
              }
              description={
                allTasks.length === 0
                  ? "Create a task to dispatch work to an agent. Tasks and runs are stored in the backend database."
                  : "Adjust the status filter or search term to see more tasks."
              }
              action={
                allTasks.length === 0 ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setDialog({ mode: "create" })}
                    leading={<Icon name="plus" className="h-3.5 w-3.5" />}
                  >
                    New task
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFilter("all");
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-line text-[10px] tracking-[0.08em] text-muted uppercase">
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Agent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Runs</th>
                  <th className="px-3 py-2.5 font-medium">Updated</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((task) => {
                  const active = task.status === "running";
                  const busy = runningId === task.id;

                  return (
                    <tr
                      key={task.id}
                      className="group align-middle transition-colors hover:bg-subtle/50"
                    >
                      <td className="max-w-[340px] px-4 py-2.5">
                        <a
                          href={hrefFor(`/tasks/${task.id}`)}
                          className="block min-w-0"
                        >
                          <span className="block truncate text-[13px] font-medium text-fg group-hover:text-accent">
                            {task.title}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted">
                            {shortId(task.id, 10)}
                            <span className="max-w-[220px] truncate text-muted/70">
                              {truncate(task.prompt, 70)}
                            </span>
                          </span>
                        </a>
                      </td>
                      <td className="px-3 py-2.5">
                        <PriorityBadge priority={task.priority} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="px-3 py-2.5">
                        <a
                          href={hrefFor(`/agents/${task.agentId}`)}
                          className="font-mono text-[11px] text-muted transition-colors hover:text-fg"
                        >
                          {task.agentId}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11px] text-muted tabular-nums">
                        {task.runs.length}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-muted">
                        {formatRelative(task.updatedAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => void submitTask(task)}
                            disabled={busy || active}
                            title={
                              active
                                ? "A run is already executing this task"
                                : "Submit for execution"
                            }
                            aria-label={`Run ${task.title}`}
                            className="rounded p-1.5 text-muted transition-colors hover:bg-subtle hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Icon name="play" className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDialog({ mode: "edit", task })}
                            title="Edit task"
                            aria-label={`Edit ${task.title}`}
                            className="rounded p-1.5 text-muted transition-colors hover:bg-subtle hover:text-fg"
                          >
                            <Icon name="edit" className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(task);
                            }}
                            title="Delete task"
                            aria-label={`Delete ${task.title}`}
                            className="rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                          >
                            <Icon name="trash" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-[11px] text-muted">
        Showing {visible.length} of {allTasks.length} tasks. Submissions start a
        real backend run and stream execution events over SSE.
      </p>

      <TaskDialog
        open={dialog !== null}
        mode={dialog?.mode ?? "create"}
        task={dialog?.mode === "edit" ? dialog.task : null}
        agents={agents.data?.agents ?? []}
        onClose={() => setDialog(null)}
        onCompleted={(result) => {
          setDialog(null);
          tasks.refetch();

          if (dialog?.mode === "edit") {
            toast({ title: "Task updated", variant: "success" });
            return;
          }

          toast({
            title: result.run ? "Task created and dispatched" : "Task created",
            description: result.run
              ? `Run ${shortId(result.run.id, 8)} started for ${result.task.agentId}.`
              : "Saved as queued. Submit it when you are ready.",
            variant: "success",
          });

          if (result.run) {
            navigate(`/runs/${result.run.id}`);
          }
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete task"
        description={
          deleting
            ? `“${deleting.title}” and all of its runs and events will be permanently deleted. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete task"
        busy={deleteBusy}
        error={deleteError ?? undefined}
        onClose={() => {
          if (!deleteBusy) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
