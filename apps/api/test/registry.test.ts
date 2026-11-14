import { describe, expect, it } from "vitest";

import { AgentRegistry } from "../src/agents/registry.js";
import { ResearchAgent } from "../src/agents/research/research.agent.js";
import { StubProvider } from "../src/llm/stub.provider.js";

describe("AgentRegistry", () => {
  const createAgent = () => new ResearchAgent(new StubProvider());

  it("registers and retrieves an agent by id", () => {
    const agent = createAgent();
    const registry = new AgentRegistry().register(agent);

    expect(registry.get(agent.id)).toBe(agent);
    expect(registry.list()).toEqual([agent]);
  });

  it("rejects duplicate ids", () => {
    const registry = new AgentRegistry().register(createAgent());

    expect(() => registry.register(createAgent())).toThrow(
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
