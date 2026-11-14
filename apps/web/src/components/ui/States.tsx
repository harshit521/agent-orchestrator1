import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong text-center",
        compact ? "px-4 py-8" : "px-6 py-14"
      )}
    >
      <div className="mb-3 grid h-8 w-8 place-items-center rounded-md border border-line bg-subtle text-muted">
        <Icon name="inbox" className="h-4 w-4" />
      </div>
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-danger/30 bg-danger-soft",
        compact ? "px-3 py-2.5" : "px-4 py-5"
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          name="alert"
          className="mt-0.5 h-4 w-4 shrink-0 text-danger"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-danger">
            Something went wrong
          </p>
          <p className="mt-0.5 text-xs leading-5 break-words text-danger/90">
            {message}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-danger underline decoration-danger/30 underline-offset-2 hover:decoration-danger"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return <ErrorState message={message} onRetry={onRetry} compact />;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded bg-subtle", className)}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({
  rows = 5,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="divide-y divide-line" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid gap-4 px-4 py-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn(
                "h-3.5",
                columnIndex === 0 ? "w-4/5" : columnIndex === columns - 1 ? "w-1/2" : "w-2/3"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-3.5 w-80" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
