import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import type { TaskPriority } from "../../types";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line bg-subtle text-muted",
  accent: "border-accent/25 bg-accent-soft text-accent",
  success: "border-ok/25 bg-ok-soft text-ok",
  warning: "border-warn/25 bg-warn-soft text-warn",
  danger: "border-danger/25 bg-danger-soft text-danger",
  info: "border-info/25 bg-info-soft text-info",
};

const DOTS: Record<BadgeTone, string> = {
  neutral: "bg-muted",
  accent: "bg-accent",
  success: "bg-ok",
  warning: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {dot ? (
        <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} />
      ) : null}
      {children}
    </span>
  );
}

const STATUS_META: Record<
  string,
  { label: string; tone: BadgeTone }
> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  in_review: { label: "In review", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  ready_to_merge: { label: "Ready to merge", tone: "accent" },
  idle: { label: "Idle", tone: "neutral" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status.replace(/_/g, " "),
    tone: "neutral" as const,
  };

  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

const PRIORITY_META: Record<
  TaskPriority,
  { label: string; tone: BadgeTone }
> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "neutral" },
  high: { label: "High", tone: "warning" },
  urgent: { label: "Urgent", tone: "danger" },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const meta =
    PRIORITY_META[priority as TaskPriority] ?? {
      label: priority,
      tone: "neutral" as const,
    };

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          meta.tone === "danger"
            ? "bg-danger"
            : meta.tone === "warning"
              ? "bg-warn"
              : "bg-line-strong"
        )}
      />
      {meta.label}
    </span>
  );
}

export function ProviderBadge({
  provider,
  model,
}: {
  provider: string | null | undefined;
  model: string | null | undefined;
}) {
  if (!provider) {
    return (
      <Badge tone="neutral" title="The backend has not reported a provider yet.">
        Not reported
      </Badge>
    );
  }

  const isStub = provider === "stub";

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Badge
        tone={isStub ? "neutral" : "accent"}
        dot
        title={
          isStub
            ? "Offline deterministic stub. This run did not call a live model."
            : `Live ${provider} execution`
        }
      >
        {isStub ? "Stub · offline" : provider}
      </Badge>
      {model ? (
        <span
          className="truncate font-mono text-[11px] text-muted"
          title={model}
        >
          {model}
        </span>
      ) : null}
    </span>
  );
}
