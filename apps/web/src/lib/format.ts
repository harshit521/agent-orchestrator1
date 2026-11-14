const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value).getTime();

  if (Number.isNaN(date)) {
    return "—";
  }

  const seconds = Math.max(0, Math.round((Date.now() - date) / 1000));

  if (seconds < 10) {
    return "just now";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);

  return days < 30 ? `${days}d ago` : formatDateTime(value);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "—";
  }

  if (ms < 1000) {
    return `${ms} ms`;
  }

  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }

  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : id.slice(0, length);
}

export function formatTokens(
  input: number | null | undefined,
  output: number | null | undefined
): string | null {
  if (
    (input === null || input === undefined) &&
    (output === null || output === undefined)
  ) {
    return null;
  }

  const parts: string[] = [];

  if (input !== null && input !== undefined) {
    parts.push(`${input.toLocaleString()} in`);
  }

  if (output !== null && output !== undefined) {
    parts.push(`${output.toLocaleString()} out`);
  }

  return parts.join(" · ");
}

export function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

export function formatJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function summaryOfOutput(output: unknown): string | null {
  if (typeof output !== "object" || output === null) {
    return typeof output === "string" ? output : null;
  }

  const record = output as Record<string, unknown>;

  return typeof record.summary === "string" ? record.summary : null;
}
