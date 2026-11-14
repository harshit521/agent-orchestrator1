import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import { formatRelative } from "../lib/format";
import { hrefFor } from "../lib/router";
import { Badge, ProviderBadge, StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel, PanelHeader } from "../components/ui/Panel";
import {
  EmptyState,
  ErrorState,
  InlineError,
  Skeleton,
} from "../components/ui/States";

function AgentStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "accent" | undefined;
}) {
  return (
    <div>
      <p className="text-[10px] tracking-[0.08em] text-muted uppercase">
        {label}
      </p>
      <p
        className={
          tone === "danger"
            ? "mt-0.5 font-mono text-[13px] text-danger tabular-nums"
            : tone === "accent"
              ? "mt-0.5 font-mono text-[13px] text-accent tabular-nums"
              : "mt-0.5 font-mono text-[13px] text-fg tabular-nums"
        }
      >
        {value}
      </p>
    </div>
  );
}

export function AgentsPage() {
  const agents = useQuery("agents", api.agents.list, {
    refreshInterval: 15_000,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agents"
        description="Agents registered by the backend at startup, with real execution aggregates."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={agents.refetch}
            loading={agents.refreshing}
            leading={<Icon name="refresh" className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      {agents.error ? (
        <InlineError
          message={`${agents.error} Showing the last loaded agents.`}
          onRetry={agents.refetch}
        />
      ) : null}

      {agents.loading && !agents.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : agents.error && !agents.data ? (
        <ErrorState message={agents.error} onRetry={agents.refetch} />
      ) : (agents.data?.agents.length ?? 0) === 0 ? (
        <EmptyState
          title="No agents registered"
          description="The backend registry is empty. Register an agent implementation to start dispatching tasks."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {agents.data?.agents.map((agent) => {
            const stats = agent.stats;
            const successRate =
              stats.totalRuns > 0
                ? Math.round((stats.completedRuns / stats.totalRuns) * 100)
                : null;

            return (
              <Panel key={agent.id} className="flex flex-col">
                <PanelHeader
                  title={
                    <a
                      href={hrefFor(`/agents/${agent.id}`)}
                      className="inline-flex items-center gap-1.5 hover:text-accent"
                    >
                      {agent.name}
                      <Icon
                        name="arrowUpRight"
                        className="h-3.5 w-3.5 text-muted"
                      />
                    </a>
                  }
                  description={agent.id}
                  action={<StatusBadge status={agent.status} />}
                />

                <div className="flex flex-1 flex-col gap-4 px-4 py-3.5">
                  <p className="text-xs leading-5 text-muted">
                    {agent.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {agent.capabilities.map((capability) => (
                      <Badge key={capability} tone="neutral">
                        {capability}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-subtle/50 px-3 py-2">
                    <ProviderBadge
                      provider={agent.provider}
                      model={agent.model}
                    />
                    <span className="text-[11px] text-muted">
                      {agent.provider === "stub"
                        ? "Offline deterministic stub — no live model calls"
                        : agent.provider
                          ? "Live provider execution"
                          : "Provider not reported"}
                    </span>
                  </div>

                  <div className="mt-auto grid grid-cols-2 gap-4 border-t border-line pt-3 sm:grid-cols-4">
                    <AgentStat label="Runs" value={stats.totalRuns} />
                    <AgentStat
                      label="Completed"
                      value={stats.completedRuns}
                      tone="accent"
                    />
                    <AgentStat
                      label="Failed"
                      value={stats.failedRuns}
                      tone={stats.failedRuns > 0 ? "danger" : undefined}
                    />
                    <AgentStat
                      label="Success"
                      value={successRate === null ? "—" : `${successRate}%`}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                    <span>
                      Last execution:{" "}
                      <span className="font-mono text-fg">
                        {stats.lastStartedAt
                          ? formatRelative(stats.lastStartedAt)
                          : "never"}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      {stats.activeRuns > 0 ? (
                        <Badge tone="info" dot>
                          {stats.activeRuns} active
                        </Badge>
                      ) : null}
                      <a
                        href={hrefFor(`/agents/${agent.id}`)}
                        className="inline-flex items-center gap-1 font-medium text-muted transition-colors hover:text-fg"
                      >
                        Details
                        <Icon name="arrowUpRight" className="h-3 w-3" />
                      </a>
                    </span>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-5 text-muted">
        Agents are registered in the backend process, not created from the UI.
        Execution counts and last-run timestamps are aggregated from persisted
        runs.
      </p>
    </div>
  );
}
