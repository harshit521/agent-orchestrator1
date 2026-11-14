import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface Metric {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "accent" | "danger" | "warn";
}

const VALUE_TONES: Record<NonNullable<Metric["tone"]>, string> = {
  default: "text-fg",
  accent: "text-accent",
  danger: "text-danger",
  warn: "text-warn",
};

export function MetricStrip({
  items,
  className,
}: {
  items: Metric[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6",
        className
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "px-4 py-3",
            index % 2 !== 0 ? "border-l border-line" : "",
            index >= 2 ? "border-t border-line sm:border-t-0" : "",
            "sm:border-l sm:first:border-l-0",
            "lg:border-t-0"
          )}
        >
          <dt className="text-[10px] font-medium tracking-[0.08em] text-muted uppercase">
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-1 text-lg leading-6 font-semibold tabular-nums",
              VALUE_TONES[item.tone ?? "default"]
            )}
          >
            {item.value}
          </dd>
          {item.hint ? (
            <p className="mt-0.5 truncate text-[11px] text-muted">{item.hint}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
