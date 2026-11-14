import { useState } from "react";

import { api } from "../api";
import { useQuery } from "../hooks/useQuery";
import { messageOf } from "../lib/errors";
import { formatDuration } from "../lib/format";
import type { ScanResponse, ScanResult } from "../types";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField, Input } from "../components/ui/Field";
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

const RESULT_TONE: Record<ScanResult["status"], BadgeTone> = {
  passed: "success",
  failed: "danger",
  unavailable: "neutral",
  error: "danger",
};

function ScanToolResult({ result }: { result: ScanResult }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RESULT_TONE[result.status]} dot>
          {result.status}
        </Badge>
        <span className="text-[13px] font-medium text-fg">{result.label}</span>
        <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">
          exit {result.exitCode ?? "—"} · {formatDuration(result.durationMs)}
        </span>
      </div>
      {result.output ? (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-muted hover:text-fg">
            <span className="group-open:hidden">Show output</span>
            <span className="hidden group-open:inline">Hide output</span>
          </summary>
          <pre className="mt-1.5 max-h-56 overflow-auto rounded-md border border-line bg-subtle/60 px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap text-fg">
            {result.output}
          </pre>
        </details>
      ) : (
        <p className="mt-1 text-[11px] text-muted">No output produced.</p>
      )}
    </li>
  );
}

export function SecurityPage() {
  const tools = useQuery("security-tools", api.security.tools);
  const { toast } = useToast();

  const [target, setTarget] = useState(".");
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  async function runScan() {
    setScanning(true);
    setScanError(null);

    try {
      const response = await api.security.scan(target.trim() || ".");
      setScan(response);

      toast({
        title:
          response.status === "passed"
            ? "Scan passed"
            : response.status === "failed"
              ? "Scan found issues"
              : "Scan completed with errors",
        description: `${response.results.length} tools ran against ${response.target}.`,
        variant:
          response.status === "passed"
            ? "success"
            : response.status === "failed"
              ? "error"
              : "info",
      });
    } catch (cause: unknown) {
      const message = messageOf(cause);
      setScanError(message);
      toast({
        title: "Scan failed to run",
        description: message,
        variant: "error",
      });
    } finally {
      setScanning(false);
    }
  }

  const enabled = tools.data?.enabled ?? false;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Security"
        description="Run the configured scanners against the project root. Results reflect the actual tools on this machine."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={tools.refetch}
            loading={tools.refreshing}
            leading={<Icon name="refresh" className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      {tools.error ? (
        <InlineError
          message={`${tools.error} Showing the last loaded tool status.`}
          onRetry={tools.refetch}
        />
      ) : null}

      {tools.loading && !tools.data ? (
        <Skeleton className="h-28 w-full" />
      ) : tools.error && !tools.data ? (
        <ErrorState message={tools.error} onRetry={tools.refetch} />
      ) : (
        <Panel>
          <PanelHeader
            title="Scanner availability"
            description="Detected from the backend host"
            action={
              <Badge tone={enabled ? "success" : "warning"} dot>
                {enabled ? "Scanning enabled" : "Scanning disabled"}
              </Badge>
            }
          />
          <PanelBody>
            <MetadataGrid
              items={[
                { label: "Root", value: tools.data?.root ?? "—", mono: true },
                { label: "Tools", value: `${tools.data?.tools.length ?? 0}` },
                { label: "Enabled", value: enabled ? "yes" : "no" },
              ]}
            />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {(tools.data?.tools ?? []).map((tool) => (
                <li
                  key={tool.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <span className="text-[12px] text-fg">{tool.label}</span>
                  <span className="font-mono text-[10px] text-muted">
                    {tool.id}
                  </span>
                  <span className="ml-auto">
                    <Badge
                      tone={tool.available ? "success" : "neutral"}
                      dot
                    >
                      {tool.available ? "available" : "not installed"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
            {!enabled ? (
              <p className="mt-3 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 text-[11px] leading-5 text-warn">
                Security scanning is disabled on the backend. Set{" "}
                <code className="font-mono">SECURITY_ENABLED=true</code> and
                restart the API to run scans.
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Run a scan"
          description="Targets are resolved inside the project root; paths cannot escape it."
        />
        <PanelBody>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField
              label="Target path"
              htmlFor="scan-target"
              className="flex-1"
              hint="Relative to the project root. Defaults to the whole repository."
            >
              <Input
                id="scan-target"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="."
                className="font-mono"
                disabled={!enabled || scanning}
              />
            </FormField>
            <Button
              variant="primary"
              onClick={() => void runScan()}
              loading={scanning}
              disabled={!enabled}
              leading={<Icon name="security" className="h-3.5 w-3.5" />}
            >
              Run scan
            </Button>
          </div>

          {scanError ? (
            <div className="mt-3">
              <InlineError message={scanError} />
            </div>
          ) : null}

          {scan ? (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    scan.status === "passed"
                      ? "success"
                      : scan.status === "failed"
                        ? "danger"
                        : "warning"
                  }
                  dot
                >
                  {scan.status}
                </Badge>
                <span className="font-mono text-[11px] text-muted">
                  {scan.target}
                </span>
              </div>
              <div className="overflow-hidden rounded-md border border-line">
                <ul className="divide-y divide-line">
                  {scan.results.map((result) => (
                    <ScanToolResult key={result.id} result={result} />
                  ))}
                </ul>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                Scan results are returned by the API and are not persisted. Run
                again to refresh.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                compact
                title="No scan has run in this session"
                description="Start a scan to execute every available scanner and review real output."
              />
            </div>
          )}
        </PanelBody>
      </Panel>

      <p className="text-[11px] leading-5 text-muted">
        Availability is probed by executing each tool's version command. Missing
        tools are reported as unavailable instead of failing the scan.
      </p>
    </div>
  );
}
