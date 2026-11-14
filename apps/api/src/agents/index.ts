import { createLLMProvider } from "../llm/index.js";
import type { LLMConfig } from "../config.js";
import { AgentRegistry } from "./registry.js";
import { ResearchAgent } from "./research/research.agent.js";

export const DEFAULT_AGENT_ID = "research-agent";

export function createAgentRegistry(llm: LLMConfig): AgentRegistry {
  const provider = createLLMProvider(llm);

  return new AgentRegistry().register(new ResearchAgent(provider));
}
