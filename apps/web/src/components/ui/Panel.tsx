import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-line bg-surface",
        className
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-4 border-b border-line px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 truncate text-xs text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function PanelBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

export function MetadataGrid({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode; mono?: boolean }>;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[10px] font-medium tracking-wider text-muted uppercase">
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-0.5 truncate text-[13px] text-fg",
              item.mono ? "font-mono text-xs" : ""
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
