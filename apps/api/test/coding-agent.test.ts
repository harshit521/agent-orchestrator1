import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CodingAgent, type CodingOutput } from "../src/agents/coding/coding.agent.js";
import type { AgentContext } from "../src/agents/base/agent-context.js";
import type { AgentProgress } from "../src/agents/base/agent-input.js";
import { StubProvider } from "../src/llm/stub.provider.js";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolRequest,
  LLMToolResponse,
} from "../src/llm/types.js";

class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  readonly defaultModel = "scripted-1";
  readonly requests: LLMToolRequest[] = [];
  readonly #responses: LLMToolResponse[];
  readonly #afterResponse: (() => void) | undefined;

  constructor(responses: LLMToolResponse[], afterResponse?: () => void) {
    this.#responses = [...responses];
    this.#afterResponse = afterResponse;
  }

  async complete(_request: LLMRequest): Promise<LLMResponse> {
    throw new Error("complete() is not used by the coding agent");
  }

  async chatWithTools(request: LLMToolRequest): Promise<LLMToolResponse> {
    this.requests.push(request);

    const response = this.#responses.shift();

    if (!response) {
      throw new Error("No scripted response left");
    }

    this.#afterResponse?.();

    return response;
  }
}

function toolResponse(
  name: string,
  args: Record<string, unknown>,
  id = name
): LLMToolResponse {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    provider: "scripted",
    model: "scripted-1",
  };
}

function contextFor(
  workspace: string,
  signal?: AbortSignal
): { context: AgentContext; progress: AgentProgress[] } {
  const progress: AgentProgress[] = [];
  const context: AgentContext = {
    taskId: "task-1",
    runId: "run-1",
    originalPrompt: "Change the code",
    previousResults: {},
    workspace: {
      taskId: "task-1",
      runId: "run-1",
      path: workspace,
      branch: "taskfleet/run-1",
    },
    ...(signal ? { signal } : {}),
    reportProgress: (entry) => progress.push(entry),
  };

  return { context, progress };
}

const options = {
  maxSteps: 6,
  maxTokens: 10_000,
  maxToolCalls: 20,
  commandTimeoutMs: 2_000,
  testTimeoutMs: 2_000,
  commandAllowlist: ["node"],
};

describe("CodingAgent", () => {
  let workspace: string;

  beforeAll(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "taskfleet-coding-"));
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("writes a real file, runs an allowlisted command and finishes", async () => {
    const provider = new ScriptedProvider([
      toolResponse("write_file", { path: "note.txt", content: "hello\n" }),
      toolResponse("run_command", {
        command: "node",
        args: ["-e", "console.log('ok')"],
      }),
      toolResponse("finish", { summary: "Wrote note.txt" }),
    ]);
    const agent = new CodingAgent(provider, options);
    const { context, progress } = contextFor(workspace);

    const result = await agent.run({ prompt: "Create note.txt" }, context);

    expect(result.status).toBe("completed");

    const output = result.output as CodingOutput;
    expect(output.summary).toBe("Wrote note.txt");
    expect(output.editedFiles).toEqual(["note.txt"]);
    expect(output.commands).toEqual([
      expect.objectContaining({ command: "node", exitCode: 0 }),
    ]);
    expect(readFileSync(path.join(workspace, "note.txt"), "utf8")).toBe(
      "hello\n"
    );
    expect(progress).toContainEqual(
      expect.objectContaining({ stage: "agent.edit", message: "Wrote note.txt" })
    );

    expect(
      provider.requests[0]?.tools.map((tool) => tool.name)
    ).toEqual(
      expect.arrayContaining([
        "read_file",
        "list_directory",
        "search_repo",
        "write_file",
        "apply_patch",
        "run_command",
        "run_tests",
        "finish",
      ])
    );
  });

  it("reports disallowed commands back to the model without executing them", async () => {
    const provider = new ScriptedProvider([
      toolResponse("run_command", { command: "rm", args: ["-rf", "."] }),
      toolResponse("finish", { summary: "Could not run rm" }),
    ]);
    const agent = new CodingAgent(provider, options);
    const { context } = contextFor(workspace);

    const result = await agent.run({ prompt: "Try a disallowed command" }, context);

    expect(result.status).toBe("completed");

    const output = result.output as CodingOutput;
    expect(output.commands).toEqual([]);

    const followUp = provider.requests[1]?.messages ?? [];
    const toolMessage = followUp.find((message) => message.role === "tool");

    expect(toolMessage).toMatchObject({ isError: true });
    expect(toolMessage?.content).toContain("not allowlisted");
  });

  it("fails clearly when the provider cannot call tools", async () => {
    const agent = new CodingAgent(new StubProvider(), options);
    const { context } = contextFor(workspace);

    const result = await agent.run({ prompt: "Edit the code" }, context);

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: "TOOL_CALLING_UNSUPPORTED" });
    expect(result.error?.message).toContain("stub");
  });

  it("honours cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new ScriptedProvider([]);
    const agent = new CodingAgent(provider, options);
    const { context } = contextFor(workspace, controller.signal);

    const result = await agent.run({ prompt: "Edit the code" }, context);

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: "CANCELLED" });
  });

  it("cancels between model steps even if the signal fires mid-loop", async () => {
    const controller = new AbortController();
    const provider = new ScriptedProvider(
      [toolResponse("write_file", { path: "cancelled.txt", content: "x" })],
      () => controller.abort()
    );
    const agent = new CodingAgent(provider, options);
    const { context } = contextFor(workspace, controller.signal);

    const result = await agent.run({ prompt: "Edit the code" }, context);

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: "CANCELLED" });
    expect(existsSync(path.join(workspace, "cancelled.txt"))).toBe(false);
  });
});
