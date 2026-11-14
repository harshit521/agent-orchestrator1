import { AgentRegistry } from "./registry.js";
import { ResearchAgent } from "./research/research.agent.js";

export const DEFAULT_AGENT_ID = "research-agent";

export function createAgentRegistry(): AgentRegistry {
  return new AgentRegistry().register(new ResearchAgent());
}
