import { useState } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export function CopyButton({
  value,
  label = "Copy",
  className,
  iconOnly = false,
}: {
  value: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      className={cn(
        "inline-flex items-center gap-1 rounded p-0.5 text-muted transition-colors hover:bg-subtle hover:text-fg",
        className
      )}
    >
      <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
      {iconOnly ? null : (
        <span className="text-[11px]">{copied ? "Copied" : "Copy"}</span>
      )}
    </button>
  );
}
