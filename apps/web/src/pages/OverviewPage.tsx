import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import { cn } from "../lib/cn";
import { formatRelative, shortId } from "../lib/format";
import { hrefFor } from "../lib/router";
import type { ActivityItem, Run } from "../types";
import { MetricStrip } from "../components/shared/MetricStrip";
import {
  Badge,
  ProviderBadge,
  StatusBadge,
  type BadgeTone,
} from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel, PanelHeader } from "../components/ui/Panel";
import {
  EmptyState,
  ErrorState,
  InlineError,
  PageSkeleton,
} from "../components/ui/States";

const EVENT_TONES: Record<string, BadgeTone> = {
  "run.started": "info",
  "agent.started": "accent",
  "agent.progress": "neutral",
  "run.progress": "neutral",
  "agent.completed": "success",
  "agent.failed": "danger",
  "run.completed": "success",
  "run.failed": "danger",
};

const DOT_COLORS: Record<BadgeTone, string> = {
  neutral: "bg-line-strong",
  accent: "bg-accent",
  success: "bg-ok",
  warning: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

function ActiveRunRow({ run }: { run: Run }) {
  return (
    <li>
      <a
        href={hrefFor(`/runs/${run.id}`)}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle/60"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
        </span>
        <span className="w-16 shrink-0 font-mono text-[11px] text-muted">
          {shortId(run.id, 8)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
          {run.task?.title ?? run.taskId}
        </span>
        <span className="hidden w-28 shrink-0 truncate font-mono text-[11px] text-muted sm:block">
          {run.agentId}
        </span>
        <ProviderBadge provider={run.provider} model={run.model} />
        <span className="hidden w-16 shrink-0 text-right font-mono text-[10px] text-muted tabular-nums sm:block">
          {formatRelative(run.startedAt)}
        </span>
      </a>
    </li>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const tone = EVENT_TONES[item.type] ?? "neutral";

  return (
    <li className="flex gap-2.5 px-4 py-2.5">
      <span
        className={cn(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          DOT_COLORS[tone]
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[12px] leading-5 text-fg">
          {item.message}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={hrefFor(`/tasks/${item.taskId}`)}
            className="max-w-full truncate text-[11px] text-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg"
          >
            {item.taskTitle}
          </a>
          <span className="font-mono text-[10px] text-muted/70">
            {item.type}
          </span>
          <time
            dateTime={item.createdAt}
            className="ml-auto font-mono text-[10px] text-muted tabular-nums"
          >
            {formatRelative(item.createdAt)}
          </time>
        </div>
      </div>
    </li>
  );
}

export function OverviewPage() {
  const stats = useQuery("stats", api.stats, { refreshInterval: 5_000 });
  const agents = useQuery("agents", api.agents.list, {
    refreshInterval: 30_000,
  });

  if (stats.loading && !stats.data) {
    return <PageSkeleton />;
  }

  if (stats.error && !stats.data) {
    return (
      <div>
        <PageHeader
          title="Overview"
          description="Operational snapshot computed from persisted tasks, runs and events."
        />
        <ErrorState message={stats.error} onRetry={stats.refetch} />
      </div>
    );
  }

  const data = stats.data;

  if (!data) {
    return null;
  }

  const agentById = new Map(
    (agents.data?.agents ?? []).map((agent) => [agent.id, agent])
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Operational snapshot computed from persisted tasks, runs and events."
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={stats.refetch}
              loading={stats.refreshing}
              leading={<Icon name="refresh" className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                window.location.hash = "/tasks";
              }}
              leading={<Icon name="plus" className="h-3.5 w-3.5" />}
            >
              New task
            </Button>
          </>
        }
      />

      {stats.error ? (
        <InlineError message={`Showing last loaded data. ${stats.error}`} />
      ) : null}

      <MetricStrip
        items={[
          { label: "Tasks", value: data.tasks.total, hint: `${data.tasks.queued} queued` },
          {
            label: "Active runs",
            value: data.runs.active,
            hint: data.runs.active > 0 ? "executing now" : "no live work",
            tone: data.runs.active > 0 ? "accent" : "default",
          },
          { label: "Completed", value: data.runs.completed, hint: "runs finished" },
          {
            label: "Failed",
            value: data.runs.failed,
            hint: data.runs.failed > 0 ? "needs review" : "none",
            tone: data.runs.failed > 0 ? "danger" : "default",
          },
          { label: "Agents", value: data.agents.total, hint: "registered" },
          {
            label: "Total runs",
            value: data.runs.total,
            hint: `${data.tasks.completed} tasks completed`,
          },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHeader
            title="Active runs"
            description={
              data.activeRuns.length > 0
                ? `${data.activeRuns.length} run${
                    data.activeRuns.length === 1 ? "" : "s"
                  } currently executing`
                : "No runs are executing right now"
            }
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

          {data.activeRuns.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] font-medium text-fg">No active runs</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted">
                Submit a task to dispatch it to an agent. Live execution events
                will appear here and on the run page.
              </p>
              <a
                href={hrefFor("/tasks")}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
              >
                Go to tasks
                <Icon name="arrowUpRight" className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.activeRuns.map((run) => (
                <ActiveRunRow key={run.id} run={run} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent activity"
            description="Latest persisted run events"
            action={
              <span className="font-mono text-[10px] text-muted">
                {data.recentActivity.length}
              </span>
            }
          />
          {data.recentActivity.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                compact
                title="No activity yet"
                description="Run events will appear here as soon as an agent starts executing a task."
              />
            </div>
          ) : (
            <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
              {data.recentActivity.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Registered agents"
          description="Agents exposed by the backend registry"
          action={
            <a
              href={hrefFor("/agents")}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-fg"
            >
              Manage
              <Icon name="arrowUpRight" className="h-3 w-3" />
            </a>
          }
        />
        {agents.error && !agents.data ? (
          <div className="px-4 py-3">
            <InlineError message={agents.error} onRetry={agents.refetch} />
          </div>
        ) : (agents.data?.agents.length ?? 0) === 0 ? (
          <p className="px-4 py-5 text-center text-xs text-muted">
            The backend reported no registered agents.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {agents.data?.agents.map((agent) => {
              const statsForAgent = agent.stats;
              const ratio =
                statsForAgent.totalRuns > 0
                  ? Math.round(
                      (statsForAgent.completedRuns / statsForAgent.totalRuns) *
                        100
                    )
                  : null;

              return (
                <li key={agent.id}>
                  <a
                    href={hrefFor(`/agents/${agent.id}`)}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-subtle/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-fg">
                        {agent.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {agent.description}
                      </span>
                    </span>
                    <ProviderBadge
                      provider={agent.provider}
                      model={agent.model}
                    />
                    <StatusBadge status={agent.status} />
                    <span className="w-24 text-right font-mono text-[11px] text-muted tabular-nums">
                      {statsForAgent.totalRuns} runs
                    </span>
                    <span className="w-20 text-right font-mono text-[11px] text-muted tabular-nums">
                      {ratio === null ? "—" : `${ratio}% ok`}
                    </span>
                    <Icon
                      name="arrowUpRight"
                      className="h-3.5 w-3.5 text-muted"
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="text-[11px] leading-5 text-muted">
        Metrics are derived from the persisted database. Agents execute with the
        configured provider
        {agents.data?.agents[0]?.provider === "stub"
          ? " (offline deterministic stub — no live model calls)"
          : ""}
        {agents.data?.agents[0]?.id
          ? `; current agent: ${agentById.get(agents.data.agents[0].id)?.name ?? "—"}`
          : ""}
        .
      </p>
    </div>
  );
}
