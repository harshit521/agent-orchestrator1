import { describe, expect, it } from "vitest";

import { AgentRegistry } from "../src/agents/registry.js";
import { ResearchAgent } from "../src/agents/research/research.agent.js";

describe("AgentRegistry", () => {
  it("registers and retrieves an agent by id", () => {
    const agent = new ResearchAgent();
    const registry = new AgentRegistry().register(agent);

    expect(registry.get(agent.id)).toBe(agent);
    expect(registry.list()).toEqual([agent]);
  });

  it("rejects duplicate ids", () => {
    const registry = new AgentRegistry().register(new ResearchAgent());

    expect(() => registry.register(new ResearchAgent())).toThrow(
      'Agent "research-agent" is already registered.'
    );
  });

  it("returns undefined for unknown ids and throws from require()", () => {
    const registry = new AgentRegistry();

    expect(registry.get("missing")).toBeUndefined();
    expect(() => registry.require("missing")).toThrow(
      'Agent "missing" is not registered.'
    );
  });
});
