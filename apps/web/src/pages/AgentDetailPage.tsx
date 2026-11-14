import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import {
  formatDuration,
  formatRelative,
  formatTokens,
  shortId,
} from "../lib/format";
import { hrefFor } from "../lib/router";
import { MetricStrip } from "../components/shared/MetricStrip";
import {
  Badge,
  ProviderBadge,
  StatusBadge,
} from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
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

export function AgentDetailPage({ agentId }: { agentId: string }) {
  const agentQuery = useQuery(
    `agent:${agentId}`,
    () => api.agents.get(agentId),
    { refreshInterval: 10_000 }
  );

  if (agentQuery.loading && !agentQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (agentQuery.error && !agentQuery.data) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Agent"
          back={{ label: "Agents", path: "/agents" }}
        />
        <ErrorState message={agentQuery.error} onRetry={agentQuery.refetch} />
      </div>
    );
  }

  const agent = agentQuery.data?.agent;

  if (!agent) {
    return null;
  }

  const stats = agent.stats;
  const recentRuns = agentQuery.data?.recentRuns ?? [];
  const successRate =
    stats.totalRuns > 0
      ? Math.round((stats.completedRuns / stats.totalRuns) * 100)
      : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {agent.name}
            <StatusBadge status={agent.status} />
          </span>
        }
        description={agent.description}
        back={{ label: "Agents", path: "/agents" }}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={agentQuery.refetch}
              loading={agentQuery.refreshing}
              leading={<Icon name="refresh" className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
            <a
              href={hrefFor("/tasks")}
              className="inline-flex h-7.5 items-center gap-1.5 rounded-md border border-transparent bg-accent px-2.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              New task
            </a>
          </>
        }
      />

      {agentQuery.error ? (
        <InlineError
          message={`${agentQuery.error} Showing the last loaded agent.`}
          onRetry={agentQuery.refetch}
        />
      ) : null}

      <MetricStrip
        items={[
          { label: "Total runs", value: stats.totalRuns },
          {
            label: "Completed",
            value: stats.completedRuns,
            tone: "accent",
          },
          {
            label: "Failed",
            value: stats.failedRuns,
            tone: stats.failedRuns > 0 ? "danger" : "default",
          },
          {
            label: "Active",
            value: stats.activeRuns,
            tone: stats.activeRuns > 0 ? "accent" : "default",
          },
          {
            label: "Success rate",
            value: successRate === null ? "—" : `${successRate}%`,
          },
          {
            label: "Last execution",
            value: stats.lastStartedAt ? formatRelative(stats.lastStartedAt) : "never",
          },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <PanelHeader
            title="Agent details"
            description="Registered implementation and reported provider"
          />
          <PanelBody>
            <MetadataGrid
              items={[
                { label: "Agent ID", value: agent.id, mono: true },
                {
                  label: "Provider",
                  value: (
                    <ProviderBadge
                      provider={agent.provider}
                      model={agent.model}
                    />
                  ),
                },
                {
                  label: "Status",
                  value: <StatusBadge status={agent.status} />,
                },
                {
                  label: "Last started",
                  value: stats.lastStartedAt
                    ? formatRelative(stats.lastStartedAt)
                    : "never",
                },
                {
                  label: "Active runs",
                  value: `${stats.activeRuns}`,
                },
                {
                  label: "Capabilities",
                  value: `${agent.capabilities.length}`,
                },
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
              {agent.capabilities.map((capability) => (
                <Badge key={capability} tone="neutral">
                  {capability}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-5 text-muted">
              {agent.provider === "stub"
                ? "This agent is running with the offline deterministic stub. Executions do not call a live language model, and token usage is not reported."
                : agent.provider
                  ? `Executions are sent to the live ${agent.provider} provider${
                      agent.model ? ` using ${agent.model}` : ""
                    }.`
                  : "The backend did not report provider metadata for this agent."}
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent runs"
            description={`Last ${recentRuns.length} execution${
              recentRuns.length === 1 ? "" : "s"
            }`}
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
          {recentRuns.length === 0 ? (
            <div className="p-4">
              <EmptyState
                compact
                title="No runs for this agent"
                description="Create and submit a task to produce the first execution."
                action={
                  <a
                    href={hrefFor("/tasks")}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                  >
                    Go to tasks
                    <Icon name="arrowUpRight" className="h-3 w-3" />
                  </a>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {recentRuns.map((run) => {
                const tokens = formatTokens(run.inputTokens, run.outputTokens);

                return (
                  <li key={run.id}>
                    <a
                      href={hrefFor(`/runs/${run.id}`)}
                      className="block px-4 py-2.5 transition-colors hover:bg-subtle/60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-fg">
                          {shortId(run.id, 10)}
                        </span>
                        <StatusBadge status={run.status} />
                        <span className="ml-auto font-mono text-[10px] text-muted">
                          {formatRelative(run.startedAt)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] text-muted">
                          {run.task?.title ?? run.taskId}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted tabular-nums">
                          {formatDuration(run.durationMs)}
                          {tokens ? ` · ${tokens}` : ""}
                        </span>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
