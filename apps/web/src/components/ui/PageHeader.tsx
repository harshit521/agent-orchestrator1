import type { ReactNode } from "react";

import { hrefFor } from "../../lib/router";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { label: string; path: string };
  meta?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back ? (
        <a
          href={hrefFor(back.path)}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
        >
          <Icon name="arrowLeft" className="h-3.5 w-3.5" />
          {back.label}
        </a>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {meta ? <div className="mt-3">{meta}</div> : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold tracking-[0.08em] text-muted uppercase">
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-line bg-subtle p-0.5",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-surface text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                : "text-muted hover:text-fg"
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "font-mono text-[10px]",
                  active ? "text-muted" : "text-muted/70"
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function BackLink({ label, path }: { label: string; path: string }) {
  return (
    <a
      href={hrefFor(path)}
      className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
    >
      <Icon name="arrowLeft" className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
