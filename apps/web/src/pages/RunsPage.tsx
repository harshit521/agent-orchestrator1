import { useMemo, useState } from "react";

import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import {
  formatDuration,
  formatRelative,
  formatTokens,
  shortId,
} from "../lib/format";
import { hrefFor } from "../lib/router";
import type { RunStatus } from "../types";
import { ProviderBadge, StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { PageHeader, Segmented } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";
import {
  EmptyState,
  ErrorState,
  InlineError,
  TableSkeleton,
} from "../components/ui/States";
import { Input } from "../components/ui/Field";

type StatusFilter = "all" | RunStatus;

const OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export function RunsPage() {
  const runs = useQuery("runs", () => api.runs.list({ limit: 200 }), {
    refreshInterval: 4_000,
  });
  const agents = useQuery("agents", api.agents.list);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [search, setSearch] = useState("");

  const allRuns = runs.data?.runs ?? [];

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      all: allRuns.length,
      running: 0,
      completed: 0,
      failed: 0,
    };

    for (const run of allRuns) {
      result[run.status] += 1;
    }

    return result;
  }, [allRuns]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return allRuns.filter((run) => {
      if (filter !== "all" && run.status !== filter) {
        return false;
      }

      if (agentFilter !== "all" && run.agentId !== agentFilter) {
        return false;
      }

      if (!term) {
        return true;
      }

      return (
        run.id.toLowerCase().includes(term) ||
        run.agentId.toLowerCase().includes(term) ||
        (run.task?.title ?? "").toLowerCase().includes(term) ||
        (run.provider ?? "").toLowerCase().includes(term) ||
        (run.model ?? "").toLowerCase().includes(term)
      );
    });
  }, [allRuns, filter, agentFilter, search]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Runs"
        description="Persisted execution history across every agent, newest first."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={runs.refetch}
            loading={runs.refreshing}
            leading={<Icon name="refresh" className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative w-full sm:max-w-xs">
            <Icon
              name="search"
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search run, task, provider…"
              aria-label="Search runs"
              className="pl-8"
            />
          </div>

          <select
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
            aria-label="Filter runs by agent"
            className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg transition-colors hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none sm:w-48"
          >
            <option value="all">All agents</option>
            {(agents.data?.agents ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        <Segmented
          value={filter}
          onChange={setFilter}
          ariaLabel="Filter runs by status"
          options={OPTIONS.map((option) => ({
            ...option,
            count: counts[option.value],
          }))}
        />
      </div>

      {runs.error ? (
        <InlineError
          message={`${runs.error} Showing the last loaded runs.`}
          onRetry={runs.refetch}
        />
      ) : null}

      <Panel>
        {runs.loading && !runs.data ? (
          <TableSkeleton rows={7} columns={7} />
        ) : runs.error && !runs.data ? (
          <div className="p-4">
            <ErrorState message={runs.error} onRetry={runs.refetch} />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={allRuns.length === 0 ? "No runs yet" : "No runs match"}
              description={
                allRuns.length === 0
                  ? "Run a task to create the first persisted execution. Live events appear on the run page."
                  : "Adjust the status, agent or search filters to see more runs."
              }
              action={
                allRuns.length === 0 ? (
                  <a
                    href={hrefFor("/tasks")}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                  >
                    Go to tasks
                    <Icon name="arrowUpRight" className="h-3 w-3" />
                  </a>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFilter("all");
                      setAgentFilter("all");
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
            <table className="w-full min-w-[940px] text-left">
              <thead>
                <tr className="border-b border-line text-[10px] tracking-[0.08em] text-muted uppercase">
                  <th className="px-4 py-2.5 font-medium">Run</th>
                  <th className="px-3 py-2.5 font-medium">Task</th>
                  <th className="px-3 py-2.5 font-medium">Agent</th>
                  <th className="px-3 py-2.5 font-medium">Provider</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2.5 font-medium">Started</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((run) => {
                  const tokens = formatTokens(run.inputTokens, run.outputTokens);

                  return (
                    <tr
                      key={run.id}
                      className="group transition-colors hover:bg-subtle/50"
                    >
                      <td className="px-4 py-2.5">
                        <a
                          href={hrefFor(`/runs/${run.id}`)}
                          className="font-mono text-[12px] text-fg transition-colors group-hover:text-accent"
                        >
                          {shortId(run.id, 12)}
                        </a>
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5">
                        {run.task ? (
                          <a
                            href={hrefFor(`/tasks/${run.task.id}`)}
                            className="block truncate text-[12px] text-muted transition-colors hover:text-fg"
                          >
                            {run.task.title}
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-muted">
                            {shortId(run.taskId, 10)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <a
                          href={hrefFor(`/agents/${run.agentId}`)}
                          className="font-mono text-[11px] text-muted transition-colors hover:text-fg"
                        >
                          {run.agentId}
                        </a>
                      </td>
                      <td className="px-3 py-2.5">
                        <ProviderBadge
                          provider={run.provider}
                          model={run.model}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11px] whitespace-nowrap text-muted tabular-nums">
                        {tokens ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-muted">
                        {formatRelative(run.startedAt)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11px] text-muted tabular-nums">
                        {formatDuration(run.durationMs)}
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
        Showing {visible.length} of {allRuns.length} runs. Token usage is only
        shown when the backend reports it.
      </p>
    </div>
  );
}
