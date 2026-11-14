import { describe, expect, it } from "vitest";

import type { AgentContext } from "../src/agents/base/agent-context.js";
import { ResearchAgent } from "../src/agents/research/research.agent.js";

function createContext(previousResults: AgentContext["previousResults"] = {}): AgentContext {
  return {
    taskId: "task-1",
    runId: "run-1",
    originalPrompt: "prompt",
    previousResults,
  };
}

describe("ResearchAgent", () => {
  const agent = new ResearchAgent();

  it("returns a completed result for a valid prompt", async () => {
    const result = await agent.run(
      { prompt: "  Explain git worktrees  " },
      createContext()
    );

    expect(result.agentId).toBe("research-agent");
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({
      topic: "Explain git worktrees",
      summary: "Research task received: Explain git worktrees",
      previousResultCount: 0,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports the number of previous agent results", async () => {
    const result = await agent.run(
      { prompt: "Summarize the context" },
      createContext({
        "planner-agent": {
          agentId: "planner-agent",
          status: "completed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 1,
        },
      })
    );

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({ previousResultCount: 1 });
  });

  it("fails with a typed error when the prompt is empty", async () => {
    const result = await agent.run({ prompt: "   " }, createContext());

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "RESEARCH_AGENT_INVALID_PROMPT",
      message: "Prompt cannot be empty.",
    });
  });
});
