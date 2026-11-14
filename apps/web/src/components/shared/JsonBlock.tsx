import { formatJson } from "../../lib/format";
import { CopyButton } from "../ui/CopyButton";

export function JsonBlock({
  value,
  label = "JSON",
  maxHeight = "max-h-72",
}: {
  value: unknown;
  label?: string;
  maxHeight?: string;
}) {
  const text = formatJson(value);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-subtle/60">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="font-mono text-[10px] tracking-wide text-muted uppercase">
          {label}
        </span>
        <CopyButton value={text} label="Copy JSON" iconOnly />
      </div>
      <pre
        className={`overflow-auto ${maxHeight} px-3 py-2.5 font-mono text-[11px] leading-5 break-words whitespace-pre-wrap text-fg`}
      >
        {text}
      </pre>
    </div>
  );
}

export function TextBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-auto rounded-md border border-line bg-subtle/60 px-3 py-2.5 font-mono text-[11px] leading-5 break-words whitespace-pre-wrap text-fg">
      {children}
    </pre>
  );
}
