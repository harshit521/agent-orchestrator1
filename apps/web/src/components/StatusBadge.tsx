const STYLES: Record<string, string> = {
  running:
    "bg-sky-400/10 text-sky-300 ring-1 ring-inset ring-sky-400/30",
  completed:
    "bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  failed:
    "bg-rose-400/10 text-rose-300 ring-1 ring-inset ring-rose-400/30",
  in_review:
    "bg-amber-300/10 text-amber-200 ring-1 ring-inset ring-amber-300/30",
  ready_to_merge:
    "bg-violet-400/10 text-violet-300 ring-1 ring-inset ring-violet-400/30",
  queued:
    "bg-slate-400/10 text-slate-300 ring-1 ring-inset ring-slate-400/30",
};

const LABELS: Record<string, string> = {
  running: "Working",
  completed: "Completed",
  failed: "Failed",
  in_review: "In review",
  ready_to_merge: "Ready to merge",
  queued: "Queued",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase ${
        STYLES[status] ?? STYLES.queued
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status] ?? status}
    </span>
  );
}
