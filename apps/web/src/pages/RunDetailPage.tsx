import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import { useRunStream, type StreamState } from "../hooks/useRunStream";
import { cn } from "../lib/cn";
import {
  formatDateTime,
  formatDuration,
  formatTime,
  summaryOfOutput,
} from "../lib/format";
import { hrefFor } from "../lib/router";
import type { RunEvent } from "../types";
import { EventTimeline, latestEvent, progressOf } from "../components/runs/EventTimeline";
import { JsonBlock, TextBlock } from "../components/shared/JsonBlock";
import { Badge, ProviderBadge, StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { CopyButton } from "../components/ui/CopyButton";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import {
  MetadataGrid,
  Panel,
  PanelBody,
  PanelHeader,
} from "../components/ui/Panel";
import {
  ErrorState,
  InlineError,
  Skeleton,
} from "../components/ui/States";

function mergeEvents(persisted: RunEvent[], live: RunEvent[]): RunEvent[] {
  const byId = new Map<string, RunEvent>();

  for (const event of persisted) {
    byId.set(event.id, event);
  }

  for (const event of live) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);

    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}

const STREAM_LABEL: Record<StreamState, string> = {
  idle: "Not streaming",
  connecting: "Connecting",
  live: "Live · SSE",
  reconnecting: "Reconnecting",
  closed: "Stream closed",
  error: "Stream error",
};

function StreamIndicator({
  state,
  active,
  onRetry,
}: {
  state: StreamState;
  active: boolean;
  onRetry: () => void;
}) {
  if (!active && (state === "idle" || state === "closed")) {
    return (
      <Badge tone="neutral" title="Persisted event history loaded from the API">
        Persisted history
      </Badge>
    );
  }

  const tone =
    state === "live"
      ? "success"
      : state === "error"
        ? "danger"
        : state === "reconnecting" || state === "connecting"
          ? "warning"
          : "neutral";

  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={tone} dot>
        {STREAM_LABEL[state]}
      </Badge>
      {(state === "error" || state === "reconnecting") && active ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-[11px] font-medium text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
        >
          Retry stream
        </button>
      ) : null}
    </span>
  );
}

function SequenceStep({
  label,
  time,
  tone,
  detail,
}: {
  label: string;
  time: string | null;
  tone: "done" | "active" | "pending" | "failed";
  detail?: string | undefined;
}) {
  const dot =
    tone === "done"
      ? "border-ok bg-ok"
      : tone === "active"
        ? "border-info bg-info"
        : tone === "failed"
          ? "border-danger bg-danger"
          : "border-line-strong bg-surface";

  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-1 h-2 w-2 shrink-0 rounded-full border-2",
          dot,
          tone === "active" ? "animate-pulse" : ""
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-[12px]",
              tone === "pending" ? "text-muted" : "text-fg"
            )}
          >
            {label}
          </span>
          <span className="font-mono text-[10px] text-muted tabular-nums">
            {time ? formatTime(time) : "—"}
          </span>
        </div>
        {detail ? (
          <p className="mt-0.5 text-[11px] leading-4 text-muted">{detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export function RunDetailPage({ runId }: { runId: string }) {
  const runQuery = useQuery(`run:${runId}`, () => api.runs.get(runId));
  const agents = useQuery("agents", api.agents.list);

  const [events, setEvents] = useState<RunEvent[]>([]);
  const [terminal, setTerminal] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  useEffect(() => {
    const persisted = runQuery.data?.run.events;

    if (persisted) {
      setEvents((current) => mergeEvents(persisted, current));
    }
  }, [runQuery.data]);

  useEffect(() => {
    if (terminal) {
      runQuery.refetch();
    }
  }, [terminal, runQuery.refetch]);

  const onEvent = useCallback((event: RunEvent) => {
    setEvents((current) =>
      current.some((existing) => existing.id === event.id)
        ? current
        : mergeEvents(current, [event])
    );

    if (event.type === "run.completed" || event.type === "run.failed") {
      setTerminal(true);
    }
  }, []);

  const run = runQuery.data?.run;
  const streamActive = run?.status === "running" && !terminal;
  const stream = useRunStream(runId, streamActive, onEvent);

  const progress = progressOf(events);
  const latest = latestEvent(events);

  const rawLog = useMemo(
    () =>
      events
        .map(
          (event) =>
            `[${formatTime(event.createdAt)}] ${event.type}${
              event.stage && event.stage !== event.type
                ? ` (${event.stage})`
                : ""
            } — ${event.message}${
              event.percent !== null ? ` [${event.percent}%]` : ""
            }`
        )
        .join("\n"),
    [events]
  );

  if (runQuery.loading && !runQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (runQuery.error && !runQuery.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Run" back={{ label: "Runs", path: "/runs" }} />
        <ErrorState message={runQuery.error} onRetry={runQuery.refetch} />
      </div>
    );
  }

  if (!run) {
    return null;
  }

  const agent = agents.data?.agents.find((entry) => entry.id === run.agentId);
  const started = events.find((event) => event.type === "run.started") ?? null;
  const agentStarted =
    events.find((event) => event.type === "agent.started") ?? null;
  const agentFinished =
    events.find(
      (event) =>
        event.type === "agent.completed" || event.type === "agent.failed"
    ) ?? null;
  const runFinished =
    events.find(
      (event) =>
        event.type === "run.completed" || event.type === "run.failed"
    ) ?? null;
  const progressCount = events.filter(
    (event) => event.type === "agent.progress" || event.type === "run.progress"
  ).length;
  const summary = summaryOfOutput(run.output);

  const metadata = [
    { label: "Run ID", value: run.id, mono: true },
    {
      label: "Task",
      value: run.task ? (
        <a
          href={hrefFor(`/tasks/${run.task.id}`)}
          className="hover:text-accent"
        >
          {run.task.title}
        </a>
      ) : (
        run.taskId
      ),
    },
    {
      label: "Agent",
      value: (
        <a
          href={hrefFor(`/agents/${run.agentId}`)}
          className="hover:text-accent"
        >
          {agent?.name ?? run.agentId}
        </a>
      ),
    },
    { label: "Provider", value: <ProviderBadge provider={run.provider} model={run.model} /> },
    { label: "Started", value: formatDateTime(run.startedAt) },
    {
      label: "Completed",
      value: run.completedAt ? formatDateTime(run.completedAt) : "—",
    },
    { label: "Duration", value: formatDuration(run.durationMs) },
    { label: "Events", value: `${events.length}` },
    {
      label: "Input tokens",
      value: run.inputTokens === null ? "—" : run.inputTokens.toLocaleString(),
      mono: true,
    },
    {
      label: "Output tokens",
      value: run.outputTokens === null ? "—" : run.outputTokens.toLocaleString(),
      mono: true,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Run
            <code className="font-mono text-[17px] text-fg">
              {run.id.slice(0, 12)}
            </code>
            <CopyButton value={run.id} label="Copy run ID" iconOnly />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge status={run.status} />
            <StreamIndicator
              state={stream.state}
              active={streamActive}
              onRetry={stream.retry}
            />
            {run.task ? (
              <a
                href={hrefFor(`/tasks/${run.task.id}`)}
                className="inline-flex min-w-0 items-center gap-1 text-[12px] text-muted transition-colors hover:text-fg"
              >
                <span className="max-w-[320px] truncate">
                  {run.task.title}
                </span>
                <Icon name="arrowUpRight" className="h-3 w-3 shrink-0" />
              </a>
            ) : null}
          </span>
        }
        back={{ label: "Runs", path: "/runs" }}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={runQuery.refetch}
              loading={runQuery.refreshing}
              leading={<Icon name="refresh" className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
            {run.task ? (
              <a
                href={hrefFor(`/tasks/${run.task.id}`)}
                className="inline-flex h-7.5 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-fg transition-colors hover:border-line-strong hover:bg-subtle"
              >
                Open task
                <Icon name="arrowUpRight" className="h-3 w-3" />
              </a>
            ) : null}
          </>
        }
      />

      {runQuery.error ? (
        <InlineError
          message={`${runQuery.error} Showing the last loaded run.`}
          onRetry={runQuery.refetch}
        />
      ) : null}

      {streamActive ? (
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-50" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-info" />
              </span>
              <span className="truncate">
                {latest?.message ?? "Waiting for the first event…"}
              </span>
            </span>
            <span className="font-mono text-[11px] text-fg tabular-nums">
              {progress === null ? "—" : `${progress}%`}
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-info transition-[width] duration-500"
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {streamActive && stream.state === "error" ? (
        <InlineError
          message="The live event stream disconnected before the run finished. The persisted history is still shown below; retry to resume live updates."
          onRetry={stream.retry}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title={run.status === "failed" ? "Failure details" : "Result"}
              description={
                run.status === "running"
                  ? "The agent is still executing"
                  : run.completedAt
                    ? `Finished ${formatDateTime(run.completedAt)}`
                    : undefined
              }
              action={<StatusBadge status={run.status} />}
            />
            {run.status === "failed" ? (
              <PanelBody>
                <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5">
                  <p className="font-mono text-[11px] font-medium text-danger">
                    {run.errorCode ?? "RUN_FAILED"}
                  </p>
                  <p className="mt-1 text-xs leading-5 break-words text-danger/90">
                    {run.errorMessage ?? "The run failed without an error message."}
                  </p>
                </div>
                {run.output !== null && run.output !== undefined ? (
                  <div className="mt-3">
                    <JsonBlock value={run.output} label="partial output" />
                  </div>
                ) : null}
              </PanelBody>
            ) : run.output !== null && run.output !== undefined ? (
              <div className="space-y-3 p-4">
                {summary ? (
                  <p className="text-[13px] leading-6 whitespace-pre-wrap text-fg">
                    {summary}
                  </p>
                ) : null}
                <JsonBlock value={run.output} label="output" maxHeight="max-h-80" />
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] font-medium text-fg">
                  {run.status === "running" ? "Execution in progress" : "No output"}
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">
                  {run.status === "running"
                    ? "Events stream in over SSE as the agent works. The final result will appear here when the run completes."
                    : "The backend completed this run without returning an output payload."}
                </p>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Execution timeline"
              description={`${events.length} event${
                events.length === 1 ? "" : "s"
              } · ${run.status === "running" ? "streaming live" : "persisted"}`}
              action={
                <span className="font-mono text-[10px] text-muted">
                  {progress === null ? "—" : `${progress}%`}
                </span>
              }
            />
            <EventTimeline events={events} />
          </Panel>

          <Panel>
            <PanelHeader
              title="Logs"
              description="Plain-text projection of the persisted event stream"
              action={
                <div className="flex items-center gap-2">
                  <CopyButton value={rawLog} label="Copy logs" iconOnly />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRawOpen((open) => !open)}
                  >
                    {rawOpen ? "Hide" : "View"}
                  </Button>
                </div>
              }
            />
            {rawOpen ? (
              <PanelBody>
                <TextBlock>{rawLog || "No events recorded."}</TextBlock>
              </PanelBody>
            ) : (
              <p className="px-4 py-4 font-mono text-[11px] text-muted">
                {events.length} log lines captured. Use View to inspect the raw
                text.
              </p>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Run details" description="Persisted record" />
            <PanelBody>
              <MetadataGrid items={metadata} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Agent sequence"
              description="Lifecycle events for this execution"
            />
            <PanelBody>
              <ol className="space-y-3">
                <SequenceStep
                  label="Run created"
                  time={started?.createdAt ?? run.startedAt}
                  tone="done"
                  detail={started?.message}
                />
                <SequenceStep
                  label="Agent started"
                  time={agentStarted?.createdAt ?? null}
                  tone={
                    streamActive
                      ? "active"
                      : agentStarted
                        ? "done"
                        : "pending"
                  }
                  detail={agentStarted?.message}
                />
                <SequenceStep
                  label={`Progress events (${progressCount})`}
                  time={latest?.createdAt ?? null}
                  tone={agentFinished ? "done" : streamActive ? "active" : "pending"}
                  detail={
                    latest && streamActive ? latest.message : undefined
                  }
                />
                <SequenceStep
                  label={
                    agentFinished?.type === "agent.failed"
                      ? "Agent failed"
                      : "Agent completed"
                  }
                  time={agentFinished?.createdAt ?? null}
                  tone={
                    agentFinished?.type === "agent.failed"
                      ? "failed"
                      : agentFinished
                        ? "done"
                        : "pending"
                  }
                  detail={agentFinished?.message}
                />
                <SequenceStep
                  label={
                    runFinished?.type === "run.failed"
                      ? "Run failed"
                      : "Run completed"
                  }
                  time={runFinished?.createdAt ?? run.completedAt}
                  tone={
                    runFinished?.type === "run.failed"
                      ? "failed"
                      : runFinished
                        ? "done"
                        : "pending"
                  }
                  detail={runFinished?.message}
                />
              </ol>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Inputs"
              description="Task prompt supplied to the agent"
            />
            <PanelBody>
              {run.task?.prompt ? (
                <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-5 break-words whitespace-pre-wrap text-fg">
                  {run.task.prompt}
                </pre>
              ) : (
                <p className="text-xs text-muted">
                  Open the task to view the stored prompt.
                </p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Provider" description="Reported by the agent result" />
            <PanelBody>
              <div className="flex flex-wrap items-center gap-2">
                <ProviderBadge provider={run.provider} model={run.model} />
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                {run.provider === "stub"
                  ? "This run used the offline deterministic stub. It did not call a live language model."
                  : run.provider
                    ? `Execution used the live ${run.provider} provider.`
                    : "The backend has not reported provider metadata for this run."}
              </p>
              {run.inputTokens !== null || run.outputTokens !== null ? (
                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[11px]">
                  <span className="text-muted">Token usage</span>
                  <span className="font-mono text-fg tabular-nums">
                    {run.inputTokens?.toLocaleString() ?? "—"} in ·{" "}
                    {run.outputTokens?.toLocaleString() ?? "—"} out
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted">
                  Token usage was not returned for this run.
                </p>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
