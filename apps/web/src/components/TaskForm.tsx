import { useState, type FormEvent } from "react";

import type { AgentSummary } from "../types";

interface TaskFormProps {
  agents: AgentSummary[];
  busy: boolean;
  onCreate: (prompt: string, agentId: string) => void;
}

export function TaskForm({ agents, busy, onCreate }: TaskFormProps) {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "research-agent");

  const selectedAgent = agents.some((agent) => agent.id === agentId)
    ? agentId
    : (agents[0]?.id ?? "research-agent");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = prompt.trim();

    if (!trimmed) {
      return;
    }

    onCreate(trimmed, selectedAgent);
    setPrompt("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-2xl shadow-black/20 backdrop-blur"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <label className="flex-1">
          <span className="mb-2 block text-xs font-medium tracking-wider text-slate-400 uppercase">
            New task
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
            placeholder="e.g. Add rate limiting to the authentication endpoint"
            className="w-full resize-none rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20 focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label>
            <span className="mb-2 block text-xs font-medium tracking-wider text-slate-400 uppercase">
              Agent
            </span>
            <select
              value={selectedAgent}
              onChange={(event) => setAgentId(event.target.value)}
              className="h-[46px] min-w-[190px] rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 text-sm text-slate-200 focus:border-sky-400/60 focus:outline-none"
            >
              {agents.length === 0 ? (
                <option value="research-agent">research-agent</option>
              ) : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={busy || prompt.trim().length === 0}
            className="h-[46px] rounded-xl bg-sky-500 px-5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {busy ? "Dispatching…" : "Dispatch task"}
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        The task is queued immediately and executed by an isolated worker. Progress
        streams into the board over SSE.
      </p>
    </form>
  );
}
