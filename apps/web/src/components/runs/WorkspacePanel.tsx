import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { formatDuration, shortId } from "../../lib/format";
import type { ChangedFile, Run, RunArtifact } from "../../types";
import { Badge, type BadgeTone } from "../ui/Badge";
import { CopyButton } from "../ui/CopyButton";
import { Icon } from "../ui/Icon";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";

interface TestSummary {
  status?: string;
  command?: string | null;
  args?: string[];
  exitCode?: number | null;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  reason?: string;
}

interface PullRequestSummary {
  status?: string;
  number?: number;
  url?: string;
  head?: string;
  base?: string;
  reason?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function artifactOf(run: Run, kind: string): RunArtifact | undefined {
  return run.artifacts?.find((artifact) => artifact.kind === kind);
}

function asChangedFiles(data: unknown): ChangedFile[] {
  return Array.isArray(data)
    ? data.filter(
        (entry): entry is ChangedFile =>
          record(entry) !== null && typeof entry.path === "string"
      )
    : [];
}

function asTests(data: unknown): TestSummary | null {
  return record(data) as TestSummary | null;
}

function asPullRequest(data: unknown): PullRequestSummary | null {
  return record(data) as PullRequestSummary | null;
}

const TEST_TONES: Record<string, BadgeTone> = {
  passed: "success",
  failed: "danger",
  skipped: "neutral",
  error: "danger",
};

const FILE_TONES: Record<string, BadgeTone> = {
  added: "success",
  modified: "warning",
  deleted: "danger",
  renamed: "info",
};

function Row({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
      <span className="shrink-0 text-[11px] text-muted">{label}</span>
      <span className="min-w-0 text-right font-mono text-[11px] break-words text-fg">
        {value}
      </span>
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-subtle/50">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="font-mono text-[10px] tracking-wide text-muted uppercase">
          Unified diff
        </span>
        <CopyButton value={diff} label="Copy diff" iconOnly />
      </div>
      <pre className="max-h-96 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-5">
        {diff.split("\n").map((line, index) => (
          <span
            key={`${index}-${line.slice(0, 20)}`}
            className={cn(
              "block whitespace-pre-wrap",
              line.startsWith("+++") || line.startsWith("---")
                ? "text-muted"
                : line.startsWith("+")
                  ? "text-ok"
                  : line.startsWith("-")
                    ? "text-danger"
                    : line.startsWith("@@")
                      ? "text-info"
                      : "text-fg"
            )}
          >
            {line || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

/**
 * Workspace/Git artifact summary for a coding run. It only renders what the
 * backend actually persisted; no mock branches, diffs, or PR links.
 */
export function WorkspacePanel({ run }: { run: Run }) {
  const filesArtifact = artifactOf(run, "changed_files");
  const diffArtifact = artifactOf(run, "diff");
  const testsArtifact = artifactOf(run, "test_results");
  const prArtifact = artifactOf(run, "pull_request");
  const output = record(run.output);
  const outputFiles = output ? asChangedFiles(output.changedFiles) : [];
  const files = asChangedFiles(filesArtifact?.data);
  const changedFiles = files.length > 0 ? files : outputFiles;
  const tests = testsArtifact ? asTests(testsArtifact.data) : null;
  const pullRequest = prArtifact ? asPullRequest(prArtifact.data) : null;
  const removed =
    run.events?.some((event) => event.type === "workspace.removed") ?? false;

  if (
    !run.branch &&
    !run.worktreePath &&
    !run.commitSha &&
    !run.pullRequestUrl &&
    changedFiles.length === 0
  ) {
    return null;
  }

  const prUrl = run.pullRequestUrl ?? pullRequest?.url;
  const prTone: BadgeTone =
    pullRequest?.status === "opened"
      ? "success"
      : pullRequest?.status === "failed"
        ? "danger"
        : "neutral";

  return (
    <Panel>
      <PanelHeader
        title="Workspace & changes"
        description={
          run.branch
            ? `${run.branch} · ${changedFiles.length} changed file${
                changedFiles.length === 1 ? "" : "s"
              }`
            : "No git workspace recorded for this run"
        }
        action={
          prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            >
              Pull request
              <Icon name="external" className="h-3 w-3" />
            </a>
          ) : (
            <Badge tone={removed ? "neutral" : "info"} dot>
              {removed ? "Worktree removed" : "Isolated worktree"}
            </Badge>
          )
        }
      />
      <div className="space-y-4 p-4">
        <div>
          <Row
            label="Branch"
            value={
              run.branch ? (
                <span className="inline-flex items-center gap-1.5">
                  {run.branch}
                  <CopyButton value={run.branch} label="Copy branch" iconOnly />
                </span>
              ) : (
                "—"
              )
            }
          />
          <Row
            label="Worktree"
            value={
              run.worktreePath ? (
                <span className="inline-flex max-w-[360px] items-center gap-1.5">
                  <span className="truncate" title={run.worktreePath}>
                    {run.worktreePath}
                  </span>
                  <CopyButton
                    value={run.worktreePath}
                    label="Copy worktree path"
                    iconOnly
                  />
                </span>
              ) : (
                "—"
              )
            }
          />
          <Row label="Base branch" value={run.baseBranch ?? "—"} />
          <Row
            label="Commit"
            value={
              run.commitSha ? (
                <span className="inline-flex items-center gap-1.5">
                  {shortId(run.commitSha, 12)}
                  <CopyButton value={run.commitSha} label="Copy commit SHA" iconOnly />
                </span>
              ) : (
                "Not committed"
              )
            }
          />
          <Row
            label="GitHub"
            value={
              prUrl ? (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {prUrl}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Badge tone={prTone}>
                    {pullRequest?.status === "failed"
                      ? "PR failed"
                      : pullRequest?.status === "unavailable"
                        ? "Unavailable"
                        : "Not opened"}
                  </Badge>
                </span>
              )
            }
          />
        </div>

        {pullRequest?.reason ? (
          <p className="rounded-md border border-warn/25 bg-warn-soft px-3 py-2 text-[11px] leading-5 text-warn">
            {pullRequest.reason}
          </p>
        ) : null}

        <div>
          <p className="mb-2 text-[11px] font-medium tracking-wide text-muted uppercase">
            Changed files
          </p>
          {changedFiles.length === 0 ? (
            <p className="text-xs text-muted">
              No file changes were recorded for this run.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {changedFiles.map((file) => (
                <li
                  key={`${file.path}-${file.status}`}
                  className="flex items-center justify-between gap-3 px-3 py-1.5"
                >
                  <code className="min-w-0 truncate font-mono text-[11px] text-fg">
                    {file.path}
                    {file.previousPath ? (
                      <span className="text-muted"> ← {file.previousPath}</span>
                    ) : null}
                  </code>
                  <Badge tone={FILE_TONES[file.status] ?? "neutral"}>
                    {file.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {diffArtifact?.content ? <DiffView diff={diffArtifact.content} /> : null}

        {tests ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                Tests
              </p>
              <Badge tone={TEST_TONES[tests.status ?? "skipped"] ?? "neutral"} dot>
                {tests.status ?? "unknown"}
              </Badge>
            </div>
            <div className="rounded-md border border-line px-3 py-2">
              <p className="font-mono text-[11px] text-fg">
                {tests.command
                  ? `${tests.command} ${(tests.args ?? []).join(" ")}`.trim()
                  : "No test command"}
                {tests.exitCode !== undefined && tests.exitCode !== null
                  ? ` · exit ${tests.exitCode}`
                  : ""}
                {typeof tests.durationMs === "number"
                  ? ` · ${formatDuration(tests.durationMs)}`
                  : ""}
              </p>
              {tests.reason ? (
                <p className="mt-1 text-[11px] text-muted">{tests.reason}</p>
              ) : null}
              {tests.stdout ? (
                <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-4 whitespace-pre-wrap text-muted">
                  {tests.stdout}
                </pre>
              ) : null}
              {tests.stderr ? (
                <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-4 whitespace-pre-wrap text-danger">
                  {tests.stderr}
                </pre>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** Compact Git/test summary used on the task detail page. */
export function WorkspaceSummary({ run }: { run: Run }) {
  const files = asChangedFiles(artifactOf(run, "changed_files")?.data);
  const tests = artifactOf(run, "test_results");
  const testSummary = tests ? asTests(tests.data) : null;
  const prUrl = run.pullRequestUrl;

  if (!run.branch && !run.commitSha && !prUrl && files.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3 text-[11px]">
      {run.branch ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Branch</span>
          <code className="min-w-0 truncate font-mono text-fg">{run.branch}</code>
        </div>
      ) : null}
      {run.commitSha ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Commit</span>
          <code className="font-mono text-fg">
            {shortId(run.commitSha, 12)}
          </code>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">Changed files</span>
        <span className="font-mono text-fg">{files.length}</span>
      </div>
      {testSummary ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Tests</span>
          <Badge tone={TEST_TONES[testSummary.status ?? "skipped"] ?? "neutral"}>
            {testSummary.status ?? "unknown"}
          </Badge>
        </div>
      ) : null}
      {prUrl ? (
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
        >
          Open pull request
          <Icon name="external" className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}
