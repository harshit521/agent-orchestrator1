import type { Agent } from "./base/agent.js";

/**
 * Holds the agents available to the orchestrator.
 *
 * The API talks to agents through this registry only, so adding a new agent
 * provider (Claude, OpenAI-compatible, CLI-based, ...) does not require
 * touching the HTTP layer.
 */
export class AgentRegistry {
  readonly #agents = new Map<string, Agent>();

  register(agent: Agent): this {
    if (this.#agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered.`);
    }

    this.#agents.set(agent.id, agent);

    return this;
  }

  get(id: string): Agent | undefined {
    return this.#agents.get(id);
  }

  require(id: string): Agent {
    const agent = this.get(id);

    if (!agent) {
      throw new Error(`Agent "${id}" is not registered.`);
    }

    return agent;
  }

  list(): Agent[] {
    return [...this.#agents.values()];
  }
}
