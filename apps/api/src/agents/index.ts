import { createLLMProvider } from "../llm/index.js";
import type { AgentConfig, LLMConfig } from "../config.js";
import { AgentRegistry } from "./registry.js";
import { CodingAgent } from "./coding/coding.agent.js";
import { ResearchAgent } from "./research/research.agent.js";

export const DEFAULT_AGENT_ID = "research-agent";

export function createAgentRegistry(
  llm: LLMConfig,
  agentConfig?: AgentConfig
): AgentRegistry {
  const provider = createLLMProvider(llm);
  const registry = new AgentRegistry().register(new ResearchAgent(provider));

  if (agentConfig) {
    registry.register(new CodingAgent(provider, agentConfig));
  }

  return registry;
}
