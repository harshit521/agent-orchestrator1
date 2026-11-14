import { useEffect, useState } from "react";

export type Route =
  | { name: "overview" }
  | { name: "tasks" }
  | { name: "task"; id: string }
  | { name: "runs" }
  | { name: "run"; id: string }
  | { name: "agents" }
  | { name: "agent"; id: string }
  | { name: "security" }
  | { name: "integrations" }
  | { name: "notFound" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "").split("?")[0] ?? "";
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { name: "overview" };
  }

  const [head, id] = segments;

  if (head === "tasks") {
    return id ? { name: "task", id } : { name: "tasks" };
  }

  if (head === "runs") {
    return id ? { name: "run", id } : { name: "runs" };
  }

  if (head === "agents") {
    return id ? { name: "agent", id } : { name: "agents" };
  }

  if (head === "security" && !id) {
    return { name: "security" };
  }

  if (head === "integrations" && !id) {
    return { name: "integrations" };
  }

  return { name: "notFound" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.hash)
  );

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);

    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

export function navigate(path: string): void {
  const target = path.startsWith("/") ? path : `/${path}`;

  if (window.location.hash === `#${target}`) {
    return;
  }

  window.location.hash = target;
}

export function hrefFor(path: string): string {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}

export function isNavActive(route: Route, name: Route["name"]): boolean {
  if (name === "tasks") {
    return route.name === "tasks" || route.name === "task";
  }

  if (name === "runs") {
    return route.name === "runs" || route.name === "run";
  }

  if (name === "agents") {
    return route.name === "agents" || route.name === "agent";
  }

  return route.name === name;
}
