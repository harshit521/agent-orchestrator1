import { z } from "zod";

import type { Agent, AgentInput } from "../base/agent.js";
import type { AgentContext } from "../base/agent-context.js";
import type { AgentResult } from "../base/agent-result.js";
import {
  LLMError,
  supportsToolCalling,
  type LLMProvider,
  type LLMToolDefinition,
  type LLMToolMessage,
} from "../../llm/types.js";
import {
  resolveTestCommand,
  runTests,
  type TestRunResult,
} from "../../runs/test-runner.js";
import { ToolError, WorkspaceTools, type CommandResult } from "./tools.js";

const promptSchema = z.string().trim().min(1, "Prompt cannot be empty.");

const readFileArgs = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

const listDirectoryArgs = z.object({ path: z.string().optional() });

const searchArgs = z.object({
  query: z.string().min(1),
  path: z.string().optional(),
  maxResults: z.number().int().positive().max(300).optional(),
});

const writeFileArgs = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const patchArgs = z.object({ patch: z.string().min(1) });

const runCommandArgs = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const finishArgs = z.object({
  summary: z.string().min(1),
});

const TOOLS: LLMToolDefinition[] = [
  {
    name: "read_file",
    description:
      "Read a UTF-8 text file inside the assigned worktree. Returns line-numbered content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description:
      "List files and directories inside the assigned worktree. Paths are relative.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory, defaults to ." },
      },
    },
  },
  {
    name: "search_repo",
    description:
      "Search tracked/untracked text files in the worktree with a literal string. Returns path:line matches.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal search text." },
        path: { type: "string", description: "Optional relative subdirectory." },
        maxResults: { type: "integer", minimum: 1, maximum: 300 },
      },
      required: ["query"],
    },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file inside the worktree with the supplied UTF-8 content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        content: { type: "string", description: "Complete new file content." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "apply_patch",
    description:
      "Apply a unified diff inside the worktree. Use this for focused edits to existing files.",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Unified diff text." },
      },
      required: ["patch"],
    },
  },
  {
    name: "run_command",
    description:
      "Run one allowlisted command inside the worktree. There is no shell; pass arguments separately.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Allowlisted executable." },
        args: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "integer", minimum: 1000 },
      },
      required: ["command"],
    },
  },
  {
    name: "run_tests",
    description:
      "Run the repository test command inside the worktree and return stdout, stderr, and the exit code.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "finish",
    description:
      "Finish the task. Call this only after the requested code changes are written and verified. Provide a concise summary.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What changed and how it was verified." },
      },
      required: ["summary"],
    },
  },
];

export interface CodingAgentOptions {
  maxSteps: number;
  maxTokens: number;
  maxToolCalls: number;
  commandTimeoutMs: number;
  testTimeoutMs: number;
  testCommand?: string;
  commandAllowlist: string[];
}

export interface CodingOutput {
  summary: string;
  workspace: string;
  branch: string;
  editedFiles: string[];
  commands: Array<{
    command: string;
    args: string[];
    exitCode: number | null;
    timedOut: boolean;
  }>;
  tests: TestRunResult | null;
  steps: number;
  toolCalls: number;
  provider: string;
  model: string;
}

const SYSTEM_PROMPT = [
  "You are the TaskFleet coding agent.",
  "You are working in an isolated git worktree. Every path you pass to a tool is relative to that worktree.",
  "You cannot access files outside the worktree, the .git directory, or any environment secrets.",
  "Use read_file, list_directory, and search_repo to inspect the code before editing.",
  "Use write_file for new or fully rewritten files and apply_patch for focused unified-diff edits.",
  "Use run_command only for allowlisted commands, and run_tests to verify the change.",
  "Make the smallest correct change that satisfies the task. Do not add unrelated files or dependencies.",
  "When the work is complete, call the finish tool with a concise summary of files changed and verification performed.",
  "If the task cannot be completed, explain why in the finish summary rather than pretending it succeeded.",
].join("\n");

class CodingAgentFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodingAgentFailure";
    this.code = code;
  }
}

export class CodingAgent implements Agent {
  readonly id = "coding-agent";
  readonly name = "Coding Agent";
  readonly description =
    "Edits files inside an isolated git worktree, runs allowlisted commands, verifies tests, and hands the result to the Git/GitHub lifecycle.";
  readonly capabilities = [
    "coding",
    "file-editing",
    "command-execution",
    "testing",
    "git",
  ];
  readonly requiresWorkspace = true;
  readonly toolCalling = true;
  readonly providerId: string;
  readonly model: string;

  readonly #provider: LLMProvider;
  readonly #options: CodingAgentOptions;

  constructor(provider: LLMProvider, options: CodingAgentOptions) {
    this.#provider = provider;
    this.#options = options;
    this.providerId = provider.id;
    this.model = provider.defaultModel;
  }

  async run(
    input: AgentInput,
    context: AgentContext
  ): Promise<AgentResult> {
    const startedAt = new Date();

    try {
      const parsed = promptSchema.safeParse(input.prompt);

      if (!parsed.success) {
        throw new CodingAgentFailure(
          "CODING_AGENT_INVALID_PROMPT",
          parsed.error.issues[0]?.message ?? "Prompt cannot be empty."
        );
      }

      if (!context.workspace) {
        throw new CodingAgentFailure(
          "WORKSPACE_REQUIRED",
          "The coding agent needs an isolated git worktree. Enable WORKTREES_ENABLED."
        );
      }

      if (!supportsToolCalling(this.#provider)) {
        throw new CodingAgentFailure(
          "TOOL_CALLING_UNSUPPORTED",
          `The ${this.#provider.id} provider does not support tool calling. ` +
            "The offline stub cannot edit files. Configure LLM_PROVIDER=openai or " +
            "LLM_PROVIDER=anthropic and set LLM_API_KEY to run the coding agent against a live model."
        );
      }

      const tools = new WorkspaceTools(context.workspace.path, {
        ...(context.signal ? { signal: context.signal } : {}),
        commandAllowlist: this.#options.commandAllowlist,
        commandTimeoutMs: this.#options.commandTimeoutMs,
      });

      const messages: LLMToolMessage[] = [
        {
          role: "user",
          content: [
            `Task: ${parsed.data}`,
            "",
            `Evidence workspace: ${context.workspace.path}`,
            `Branch: ${context.workspace.branch}`,
          ].join("\n"),
        },
      ];

      const editedFiles = new Set<string>();
      const commands: CodingOutput["commands"] = [];
      let steps = 0;
      let toolCallCount = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let summary = "";
      let lastText = "";
      let testResults: TestRunResult | null = null;
      let finished = false;

      while (steps < this.#options.maxSteps) {
        this.#assertNotAborted(context.signal);
        steps += 1;

        context.reportProgress?.({
          stage: "agent.thinking",
          message: `Planning step ${steps} of ${this.#options.maxSteps}`,
          percent: Math.min(85, 10 + steps * 2),
          data: { step: steps },
        });

        const response = await this.#provider.chatWithTools({
          system: SYSTEM_PROMPT,
          messages,
          tools: TOOLS,
          ...(context.signal ? { signal: context.signal } : {}),
        });

        inputTokens += response.usage?.inputTokens ?? 0;
        outputTokens += response.usage?.outputTokens ?? 0;

        if (inputTokens + outputTokens > this.#options.maxTokens) {
          throw new CodingAgentFailure(
            "AGENT_TOKEN_LIMIT",
            `The agent exceeded its token budget of ${this.#options.maxTokens} tokens.`
          );
        }

        lastText = response.text.trim();

        if (response.toolCalls.length === 0) {
          summary = lastText || "The agent finished without a summary.";
          break;
        }

        messages.push({
          role: "assistant",
          content: response.text,
          toolCalls: response.toolCalls,
        });

        for (const call of response.toolCalls) {
          this.#assertNotAborted(context.signal);
          toolCallCount += 1;

          if (toolCallCount > this.#options.maxToolCalls) {
            throw new CodingAgentFailure(
              "AGENT_TOOL_LIMIT",
              `The agent exceeded its tool-call limit of ${this.#options.maxToolCalls}.`
            );
          }

          const execution = await this.#executeTool(call.name, call.arguments, {
            tools,
            context,
            editedFiles,
            commands,
            testResults,
          });

          if (execution.tests) {
            testResults = execution.tests;
          }

          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: execution.text,
            ...(execution.isError ? { isError: true } : {}),
          });

          if (execution.finished) {
            summary = execution.summary ?? "The agent finished.";
            finished = true;
            break;
          }
        }

        if (finished) {
          break;
        }
      }

      if (!finished && summary.length === 0) {
        throw new CodingAgentFailure(
          "AGENT_MAX_STEPS",
          `The agent reached the maximum of ${this.#options.maxSteps} steps without finishing.`
        );
      }

      const output: CodingOutput = {
        summary,
        workspace: context.workspace.path,
        branch: context.workspace.branch,
        editedFiles: [...editedFiles],
        commands,
        tests: testResults,
        steps,
        toolCalls: toolCallCount,
        provider: this.#provider.id,
        model: this.#provider.defaultModel,
      };

      return {
        agentId: this.id,
        status: "completed",
        output,
        provider: this.#provider.id,
        model: this.#provider.defaultModel,
        ...(inputTokens > 0 || outputTokens > 0
          ? {
              usage: {
                ...(inputTokens > 0 ? { inputTokens } : {}),
                ...(outputTokens > 0 ? { outputTokens } : {}),
              },
            }
          : {}),
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      };
    } catch (error: unknown) {
      const code =
        error instanceof CodingAgentFailure
          ? error.code
          : error instanceof LLMError
            ? error.code
            : error instanceof ToolError
              ? error.code
              : "CODING_AGENT_FAILED";
      const message =
        error instanceof Error ? error.message : "An unknown error occurred.";

      return {
        agentId: this.id,
        status: "failed",
        error: { code, message },
        provider: this.#provider.id,
        model: this.#provider.defaultModel,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      };
    }
  }

  async #executeTool(
    name: string,
    rawArguments: string,
    state: {
      tools: WorkspaceTools;
      context: AgentContext;
      editedFiles: Set<string>;
      commands: CodingOutput["commands"];
      testResults: TestRunResult | null;
    }
  ): Promise<{
    text: string;
    isError?: boolean;
    finished?: boolean;
    summary?: string;
    tests?: TestRunResult;
  }> {
    try {
      const args = parseArguments(rawArguments);

      switch (name) {
        case "read_file": {
          const parsed = readFileArgs.parse(args);
          const text = await state.tools.readFile({
            path: parsed.path,
            ...(parsed.startLine !== undefined
              ? { startLine: parsed.startLine }
              : {}),
            ...(parsed.endLine !== undefined ? { endLine: parsed.endLine } : {}),
          });

          this.#progress(state.context, "agent.tool", `Read ${parsed.path}`, {
            tool: name,
            path: parsed.path,
          });

          return { text };
        }

        case "list_directory": {
          const parsed = listDirectoryArgs.parse(args);
          const path = parsed.path ?? ".";
          const text = await state.tools.listDirectory(path);

          this.#progress(state.context, "agent.tool", `Listed ${path}`, {
            tool: name,
            path,
          });

          return { text };
        }

        case "search_repo": {
          const parsed = searchArgs.parse(args);
          const text = await state.tools.search({
            query: parsed.query,
            ...(parsed.path !== undefined ? { path: parsed.path } : {}),
            ...(parsed.maxResults !== undefined
              ? { maxResults: parsed.maxResults }
              : {}),
          });

          this.#progress(
            state.context,
            "agent.tool",
            `Searched for "${parsed.query}"`,
            { tool: name, query: parsed.query }
          );

          return { text };
        }

        case "write_file": {
          const parsed = writeFileArgs.parse(args);
          const text = await state.tools.writeFile(parsed);
          state.editedFiles.add(parsed.path);

          this.#progress(state.context, "agent.edit", `Wrote ${parsed.path}`, {
            tool: name,
            paths: [parsed.path],
          });

          return { text };
        }

        case "apply_patch": {
          const parsed = patchArgs.parse(args);
          const text = await state.tools.applyPatch(parsed);
          const paths = patchPaths(parsed.patch);

          for (const path of paths) {
            state.editedFiles.add(path);
          }

          this.#progress(
            state.context,
            "agent.edit",
            `Applied a patch to ${paths.join(", ") || "the worktree"}`,
            { tool: name, paths }
          );

          return { text };
        }

        case "run_command": {
          const parsed = runCommandArgs.parse(args);
          const result = await state.tools.runCommand({
            command: parsed.command,
            ...(parsed.args !== undefined ? { args: parsed.args } : {}),
            ...(parsed.timeoutMs !== undefined
              ? { timeoutMs: parsed.timeoutMs }
              : {}),
          });

          state.commands.push({
            command: result.command,
            args: result.args,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
          });

          this.#progress(
            state.context,
            "agent.command",
            `Ran ${result.command}${result.args.length ? ` ${result.args.join(" ")}` : ""}`,
            {
              tool: name,
              exitCode: result.exitCode,
              timedOut: result.timedOut,
            }
          );

          return {
            text: formatCommand(result),
            ...(result.exitCode !== 0 || result.timedOut ? { isError: true } : {}),
          };
        }

        case "run_tests": {
          const command = await resolveTestCommand(
            state.tools.root,
            this.#options.testCommand
          );

          if (!command) {
            return {
              text:
                "No test command was detected. The orchestrator will skip automatic tests.",
              isError: false,
            };
          }

          const result = await runTests(state.tools.root, command, {
            timeoutMs: this.#options.testTimeoutMs,
            ...(state.context.signal ? { signal: state.context.signal } : {}),
          });

          this.#progress(
            state.context,
            result.status === "passed" ? "agent.tests" : "agent.tests",
            `Tests ${result.status} (${result.command ?? "unknown"})`,
            { tool: name, status: result.status, exitCode: result.exitCode }
          );

          return {
            text: [
              `Tests ${result.status}.`,
              result.command
                ? `Command: ${result.command} ${result.args.join(" ")}`.trim()
                : "",
              result.stdout ? `stdout:\n${result.stdout}` : "",
              result.stderr ? `stderr:\n${result.stderr}` : "",
            ]
              .filter((line) => line.length > 0)
              .join("\n"),
            ...(result.status === "passed" ? {} : { isError: true }),
            tests: result,
          };
        }

        case "finish": {
          const parsed = finishArgs.parse(args);

          return {
            text: "Acknowledged. The orchestrator will now diff, test, commit, and publish the change.",
            finished: true,
            summary: parsed.summary,
          };
        }

        default:
          return {
            text: `Unknown tool: ${name}. Available tools: ${TOOLS.map(
              (tool) => tool.name
            ).join(", ")}`,
            isError: true,
          };
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Tool execution failed.";

      return { text: message, isError: true };
    }
  }

  #progress(
    context: AgentContext,
    stage: string,
    message: string,
    data: Record<string, unknown>
  ): void {
    context.reportProgress?.({
      stage,
      message,
      data,
    });
  }

  #assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new CodingAgentFailure(
        "CANCELLED",
        "The coding run was cancelled."
      );
    }
  }
}

function parseArguments(raw: string): unknown {
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CodingAgentFailure(
      "INVALID_TOOL_ARGUMENTS",
      `Tool arguments were not valid JSON: ${raw.slice(0, 200)}`
    );
  }
}

function patchPaths(patch: string): string[] {
  const paths = new Set<string>();

  for (const line of patch.split("\n")) {
    const match = /^(?:diff --git a\/(.+?) b\/|\+\+\+ b\/(.+)|--- a\/(.+))$/.exec(
      line
    );
    const candidate = match?.[1] ?? match?.[2] ?? match?.[3];

    if (candidate && candidate !== "/dev/null") {
      paths.add(candidate.trim());
    }
  }

  return [...paths];
}

function formatCommand(result: CommandResult): string {
  return [
    `$ ${result.command}${result.args.length ? ` ${result.args.join(" ")}` : ""}`,
    `exit code: ${result.exitCode ?? "none"}${
      result.timedOut ? " (timed out)" : ""
    }`,
    result.stdout ? `stdout:\n${result.stdout}` : "",
    result.stderr ? `stderr:\n${result.stderr}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
