import { useState } from "react";

import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import { messageOf } from "../lib/errors";
import {
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTokens,
  shortId,
} from "../lib/format";
import { hrefFor, navigate } from "../lib/router";
import type { Run, Task } from "../types";
import { latestEvent, progressOf } from "../components/runs/EventTimeline";
import { JsonBlock } from "../components/shared/JsonBlock";
import { TaskDialog } from "../components/tasks/TaskDialog";
import { PriorityBadge, ProviderBadge, StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import {
  MetadataGrid,
  Panel,
  PanelBody,
  PanelHeader,
} from "../components/ui/Panel";
import {
  EmptyState,
  ErrorState,
  InlineError,
  Skeleton,
} from "../components/ui/States";
import { useToast } from "../components/ui/Toast";

function RunProgress({ run }: { run: Run }) {
  const events = run.events ?? [];
  const progress = progressOf(events);
  const latest = latestEvent(events);

  return (
    <div className="mt-2 max-w-sm">
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span className="truncate">{latest?.message ?? "Awaiting events"}</span>
        <span className="font-mono tabular-nums">
          {progress === null ? "—" : `${progress}%`}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-info transition-[width] duration-300"
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function RunHistoryRow({ run }: { run: Run }) {
  const tokens = formatTokens(run.inputTokens, run.outputTokens);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <a
          href={hrefFor(`/runs/${run.id}`)}
          className="font-mono text-[12px] text-fg transition-colors hover:text-accent"
        >
          {shortId(run.id, 12)}
        </a>
        <StatusBadge status={run.status} />
        <ProviderBadge provider={run.provider} model={run.model} />
        <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">
          {formatRelative(run.startedAt)}
        </span>
        <span className="font-mono text-[10px] text-muted tabular-nums">
          {formatDuration(run.durationMs)}
        </span>
        <span className="w-24 text-right font-mono text-[10px] text-muted tabular-nums">
          {tokens ?? "no usage"}
        </span>
        <Icon name="arrowUpRight" className="h-3 w-3 text-muted" />
      </div>
      {run.status === "running" ? <RunProgress run={run} /> : null}
      {run.errorMessage ? (
        <p className="mt-1.5 text-[11px] leading-4 text-danger">
          {run.errorCode ? `${run.errorCode}: ` : ""}
          {run.errorMessage}
        </p>
      ) : null}
    </li>
  );
}

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const taskQuery = useQuery(`task:${taskId}`, () => api.tasks.get(taskId), {
    refreshInterval: 4_000,
  });
  const agents = useQuery("agents", api.agents.list);
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  if (taskQuery.loading && !taskQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (taskQuery.error && !taskQuery.data) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Task"
          back={{ label: "Tasks", path: "/tasks" }}
        />
        <ErrorState message={taskQuery.error} onRetry={taskQuery.refetch} />
      </div>
    );
  }

  const task = taskQuery.data?.task;

  if (!task) {
    return null;
  }

  const agent = agents.data?.agents.find((entry) => entry.id === task.agentId);
  const activeRun = task.runs.find((run) => run.status === "running");
  const latestRun = task.runs[0];
  const currentTask = task;

  async function submitRun() {
    setRunBusy(true);

    try {
      const response = await api.tasks.run(currentTask.id);
      toast({
        title: "Run dispatched",
        description: `Task sent to ${currentTask.agentId}.`,
        variant: "success",
      });

      if (response.run) {
        navigate(`/runs/${response.run.id}`);
      } else {
        taskQuery.refetch();
      }
    } catch (cause: unknown) {
      toast({
        title: "Could not start the run",
        description: messageOf(cause),
        variant: "error",
      });
    } finally {
      setRunBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);

    try {
      await api.tasks.remove(currentTask.id);
      toast({
        title: "Task deleted",
        description: "The task and its run history were removed.",
        variant: "success",
      });
      navigate("/tasks");
    } catch (cause: unknown) {
      setDeleteError(messageOf(cause));
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={task.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <a
              href={hrefFor(`/agents/${task.agentId}`)}
              className="font-mono text-[11px] text-muted transition-colors hover:text-fg"
            >
              {task.agentId}
            </a>
          </span>
        }
        back={{ label: "Tasks", path: "/tasks" }}
        actions={
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void submitRun()}
              loading={runBusy}
              disabled={Boolean(activeRun)}
              leading={<Icon name="play" className="h-3.5 w-3.5" />}
            >
              {activeRun ? "Running" : "Run task"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(true)}
              leading={<Icon name="edit" className="h-3.5 w-3.5" />}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setDeleteError(null);
                setDeleting(true);
              }}
              leading={<Icon name="trash" className="h-3.5 w-3.5" />}
            >
              Delete
            </Button>
          </>
        }
      />

      {taskQuery.error ? (
        <InlineError
          message={`${taskQuery.error} Showing the last loaded task.`}
          onRetry={taskQuery.refetch}
        />
      ) : null}

      {activeRun ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/25 bg-info-soft px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-info">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
            </span>
            A run is executing this task.
          </div>
          <a
            href={hrefFor(`/runs/${activeRun.id}`)}
            className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
          >
            Open live run {shortId(activeRun.id, 8)}
            <Icon name="arrowUpRight" className="h-3 w-3" />
          </a>
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          title="Task details"
          description="Persisted task record"
          action={
            <span className="font-mono text-[10px] text-muted">
              {shortId(task.id, 12)}
            </span>
          }
        />
        <PanelBody>
          <MetadataGrid
            items={[
              {
                label: "Task ID",
                value: task.id,
                mono: true,
              },
              {
                label: "Agent",
                value: (
                  <a
                    href={hrefFor(`/agents/${task.agentId}`)}
                    className="hover:text-accent"
                  >
                    {agent?.name ?? task.agentId}
                  </a>
                ),
              },
              {
                label: "Provider",
                value: agent ? (
                  <ProviderBadge
                    provider={agent.provider}
                    model={agent.model}
                  />
                ) : (
                  "—"
                ),
              },
              {
                label: "Created",
                value: formatDateTime(task.createdAt),
              },
              {
                label: "Updated",
                value: formatRelative(task.updatedAt),
              },
              {
                label: "Runs",
                value: `${task.runs.length}`,
              },
            ]}
          />
        </PanelBody>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <PanelHeader
            title="Prompt"
            description="Sent verbatim to the agent on every execution"
          />
          <PanelBody>
            <pre className="font-mono text-[12px] leading-6 break-words whitespace-pre-wrap text-fg">
              {task.prompt}
            </pre>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Latest result"
            description={
              latestRun
                ? `Run ${shortId(latestRun.id, 10)} · ${formatRelative(
                    latestRun.startedAt
                  )}`
                : "No executions yet"
            }
          />
          {latestRun?.errorMessage ? (
            <PanelBody>
              <p className="text-[11px] font-medium text-danger">
                {latestRun.errorCode ?? "Error"}
              </p>
              <p className="mt-1 text-xs leading-5 break-words text-muted">
                {latestRun.errorMessage}
              </p>
            </PanelBody>
          ) : latestRun?.output !== null &&
            latestRun?.output !== undefined ? (
            <div className="p-4">
              <JsonBlock
                value={latestRun.output}
                label="result"
                maxHeight="max-h-56"
              />
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-muted">
              {latestRun
                ? "This run has not produced output yet."
                : "Submit the task to produce a result."}
            </p>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Execution history"
          description={`${task.runs.length} run${
            task.runs.length === 1 ? "" : "s"
          } recorded for this task`}
          action={
            <a
              href={hrefFor("/runs")}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-fg"
            >
              All runs
              <Icon name="arrowUpRight" className="h-3 w-3" />
            </a>
          }
        />
        {task.runs.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              title="No executions yet"
              description="Run this task to create a persistent run with its event history."
              action={
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void submitRun()}
                  loading={runBusy}
                  leading={<Icon name="play" className="h-3.5 w-3.5" />}
                >
                  Run task
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {task.runs.map((run) => (
              <RunHistoryRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </Panel>

      <TaskDialog
        open={editing}
        mode="edit"
        task={task}
        agents={agents.data?.agents ?? []}
        onClose={() => setEditing(false)}
        onCompleted={() => {
          setEditing(false);
          taskQuery.refetch();
          toast({ title: "Task updated", variant: "success" });
        }}
      />

      <ConfirmDialog
        open={deleting}
        title="Delete task"
        description={`“${task.title}” and all of its runs and events will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete task"
        busy={deleteBusy}
        error={deleteError ?? undefined}
        onClose={() => {
          if (!deleteBusy) {
            setDeleting(false);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
