import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export type IconName =
  | "overview"
  | "tasks"
  | "runs"
  | "agents"
  | "security"
  | "integrations"
  | "plus"
  | "search"
  | "close"
  | "sun"
  | "moon"
  | "arrowLeft"
  | "arrowUpRight"
  | "copy"
  | "check"
  | "play"
  | "edit"
  | "trash"
  | "refresh"
  | "external"
  | "alert"
  | "inbox"
  | "chevronDown"
  | "terminal";

const PATHS: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="4" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  tasks: (
    <>
      <path d="M4 6.5h9M4 12h9M4 17.5h6" />
      <path d="m16.5 6.5 2 2 3-3.5M16.5 16.5l2 2 3-3.5" />
    </>
  ),
  runs: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 6 3.5-6 3.5v-7Z" />
    </>
  ),
  agents: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" />
    </>
  ),
  security: (
    <>
      <path d="M12 3 19 6v5.2c0 4.4-2.9 7.6-7 9.3-4.1-1.7-7-4.9-7-9.3V6l7-3Z" />
      <path d="m9.5 12 1.8 1.8 3.5-3.6" />
    </>
  ),
  integrations: (
    <>
      <path d="M9.5 14.5 5.8 18.2a3 3 0 0 1-4.2-4.2l3.7-3.7" />
      <path d="m14.5 9.5 3.7-3.7a3 3 0 0 1 4.2 4.2l-3.7 3.7" />
      <path d="m8.5 15.5 7-7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  arrowLeft: <path d="M19 12H5m7 7-7-7 7-7" />,
  arrowUpRight: <path d="M7 17 17 7M8 7h9v9" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1.5" />
    </>
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
  play: <path d="M8 5.5v13l11-6.5-11-6.5Z" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5M12 17.2v.1" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13h5l2 3h4l2-3h5" />
      <path d="M5 5h14l2 8v6H3v-6l2-8Z" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  terminal: <path d="m5 7 4 5-4 5M12 17h7" />,
};

export function Icon({
  name,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
    >
      {PATHS[name]}
    </svg>
  );
}
