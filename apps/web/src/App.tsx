import { useEffect } from "react";

import { AppShell } from "./components/layout/AppShell";
import { hrefFor, useRoute } from "./lib/router";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { AgentsPage } from "./pages/AgentsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { RunsPage } from "./pages/RunsPage";
import { SecurityPage } from "./pages/SecurityPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { TasksPage } from "./pages/TasksPage";

function Page() {
  const route = useRoute();

  switch (route.name) {
    case "overview":
      return <OverviewPage />;
    case "tasks":
      return <TasksPage />;
    case "task":
      return <TaskDetailPage key={route.id} taskId={route.id} />;
    case "runs":
      return <RunsPage />;
    case "run":
      return <RunDetailPage key={route.id} runId={route.id} />;
    case "agents":
      return <AgentsPage />;
    case "agent":
      return <AgentDetailPage key={route.id} agentId={route.id} />;
    case "security":
      return <SecurityPage />;
    case "integrations":
      return <IntegrationsPage />;
    case "notFound":
      return <NotFoundPage />;
    default:
      return <NotFoundPage />;
  }
}

export default function App() {
  const route = useRoute();
  const routeKey =
    route.name === "task" || route.name === "run" || route.name === "agent"
      ? `${route.name}:${route.id}`
      : route.name;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [routeKey]);

  return (
    <AppShell route={route}>
      <Page />
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[11px] text-muted">
        <span>
          TaskFleet · agent orchestration control plane
        </span>
        <span className="flex items-center gap-3">
          <a
            href={hrefFor("/integrations")}
            className="transition-colors hover:text-fg"
          >
            Integrations
          </a>
          <a
            href={hrefFor("/security")}
            className="transition-colors hover:text-fg"
          >
            Security
          </a>
        </span>
      </footer>
    </AppShell>
  );
}
