import type { ReactNode } from "react";

import { api } from "../../api";
import { useQuery } from "../../hooks/useQuery";
import { cn } from "../../lib/cn";
import {
  hrefFor,
  isNavActive,
  type Route,
} from "../../lib/router";
import { useTheme } from "../../lib/theme";
import { Icon, type IconName } from "../ui/Icon";

const NAV: Array<{
  section: string;
  items: Array<{ label: string; path: string; name: Route["name"]; icon: IconName }>;
}> = [
  {
    section: "Workspace",
    items: [
      { label: "Overview", path: "/", name: "overview", icon: "overview" },
      { label: "Tasks", path: "/tasks", name: "tasks", icon: "tasks" },
      { label: "Runs", path: "/runs", name: "runs", icon: "runs" },
      { label: "Agents", path: "/agents", name: "agents", icon: "agents" },
    ],
  },
  {
    section: "System",
    items: [
      {
        label: "Security",
        path: "/security",
        name: "security",
        icon: "security",
      },
      {
        label: "Integrations",
        path: "/integrations",
        name: "integrations",
        icon: "integrations",
      },
    ],
  },
];

function Brand() {
  return (
    <a
      href={hrefFor("/")}
      className="flex items-center gap-2.5 rounded-md px-1 py-0.5"
      aria-label="TaskFleet overview"
    >
      <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-fg">
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 7h14M12 7v11" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] leading-4 font-semibold tracking-tight text-fg">
          TaskFleet
        </span>
        <span className="block text-[10px] leading-4 tracking-wide text-muted">
          Agent control plane
        </span>
      </span>
    </a>
  );
}

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-subtle hover:text-fg",
        compact ? "" : "w-full"
      )}
    >
      <Icon name={dark ? "sun" : "moon"} className="h-3.5 w-3.5" />
      {compact ? null : <span>{dark ? "Light mode" : "Dark mode"}</span>}
    </button>
  );
}

function ApiStatus({ compact = false }: { compact?: boolean }) {
  const health = useQuery("health", api.health, { refreshInterval: 15_000 });
  const online = Boolean(health.data) && !health.error;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-muted"
      title={
        health.error
          ? health.error
          : health.data
            ? `API healthy · uptime ${health.data.uptimeSeconds}s`
            : "Checking API"
      }
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          health.loading && !health.data
            ? "bg-muted/50"
            : online
              ? "bg-ok"
              : "bg-danger"
        )}
      />
      {compact ? null : online ? "API connected" : "API unreachable"}
    </span>
  );
}

function NavLinks({
  route,
  mobile = false,
}: {
  route: Route;
  mobile?: boolean;
}) {
  if (mobile) {
    return (
      <nav className="flex items-center gap-1 overflow-x-auto px-2 pb-2">
        {NAV.flatMap((group) => group.items).map((item) => {
          const active = isNavActive(route, item.name);

          return (
            <a
              key={item.path}
              href={hrefFor(item.path)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors",
                active
                  ? "bg-subtle text-fg"
                  : "text-muted hover:bg-subtle/70 hover:text-fg"
              )}
            >
              <Icon
                name={item.icon}
                className={cn(
                  "h-3.5 w-3.5",
                  active ? "text-accent" : "text-muted"
                )}
              />
              {item.label}
            </a>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-1 flex-col gap-5 px-3">
      {NAV.map((group) => (
        <div key={group.section}>
          <p className="mb-1.5 px-2 text-[10px] font-semibold tracking-[0.08em] text-muted/80 uppercase">
            {group.section}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isNavActive(route, item.name);

              return (
                <a
                  key={item.path}
                  href={hrefFor(item.path)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                    active
                      ? "bg-subtle font-medium text-fg"
                      : "text-muted hover:bg-subtle/70 hover:text-fg"
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />
                  ) : null}
                  <Icon
                    name={item.icon}
                    className={cn(
                      "h-4 w-4",
                      active
                        ? "text-accent"
                        : "text-muted group-hover:text-fg"
                    )}
                  />
                  {item.label}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  route,
  children,
}: {
  route: Route;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-3 py-4">
          <Brand />
        </div>
        <NavLinks route={route} />
        <div className="space-y-2 border-t border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <ApiStatus />
            <span className="font-mono text-[10px] text-muted/70">v0.1</span>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur lg:hidden">
          <div className="flex h-12 items-center justify-between px-3">
            <Brand />
            <div className="flex items-center gap-2">
              <ApiStatus compact />
              <ThemeToggle compact />
            </div>
          </div>
          <NavLinks route={route} mobile />
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
