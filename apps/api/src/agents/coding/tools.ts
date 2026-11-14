import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PathJail, PathJailError } from "../../worktrees/path-jail.js";

const run = promisify(execFile);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".taskfleet",
]);

const MAX_FILE_BYTES = 1_000_000;
const MAX_READ_CHARS = 200_000;
const MAX_COMMAND_OUTPUT = 20_000;
const MAX_PATCH_BYTES = 1_000_000;

export class ToolError extends Error {
  readonly code: string;

  constructor(message: string, code = "TOOL_ERROR") {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

export interface WorkspaceToolsOptions {
  signal?: AbortSignal;
  commandAllowlist: string[];
  commandTimeoutMs: number;
}

export class WorkspaceTools {
  readonly root: string;
  readonly #jail: PathJail;
  readonly #signal: AbortSignal | undefined;
  readonly #allowlist: Set<string>;
  readonly #commandTimeoutMs: number;

  constructor(root: string, options: WorkspaceToolsOptions) {
    this.root = path.resolve(root);
    this.#jail = new PathJail(this.root);
    this.#signal = options.signal;
    this.#allowlist = new Set(options.commandAllowlist);
    this.#commandTimeoutMs = options.commandTimeoutMs;
  }

  #resolve(
    inputPath: string,
    options: { allowGit?: boolean } = {}
  ): string {
    try {
      return this.#jail.resolve(inputPath, options);
    } catch (error: unknown) {
      if (error instanceof PathJailError) {
        throw new ToolError(error.message, error.code);
      }

      throw error;
    }
  }

  #relative(inputPath: string): string {
    try {
      return this.#jail.relative(inputPath);
    } catch (error: unknown) {
      if (error instanceof PathJailError) {
        throw new ToolError(error.message, error.code);
      }

      throw error;
    }
  }

  async readFile(input: {
    path: string;
    startLine?: number;
    endLine?: number;
  }): Promise<string> {
    this.#assertNotAborted();

    const file = this.#resolve(input.path);

    const details = await stat(file).catch(() => null);

    if (!details?.isFile()) {
      throw new ToolError(`Not a file: ${input.path}`, "NOT_A_FILE");
    }

    if (details.size > MAX_FILE_BYTES * 5) {
      throw new ToolError(
        `File is too large to read (${details.size} bytes).`,
        "FILE_TOO_LARGE"
      );
    }

    const content = await readFile(file, "utf8");
    const lines = content.split("\n");
    const start = Math.max(1, input.startLine ?? 1);
    const end = Math.min(lines.length, input.endLine ?? lines.length);

    if (start > end || start > lines.length) {
      throw new ToolError(
        `Invalid line range ${start}-${end} for ${lines.length} lines.`,
        "INVALID_RANGE"
      );
    }

    const selected = lines.slice(start - 1, end).join("\n");
    const numbered = selected
      .split("\n")
      .map((line, index) => `${start + index}: ${line}`)
      .join("\n");

    return truncate(numbered, MAX_READ_CHARS);
  }

  async listDirectory(inputPath = "."): Promise<string> {
    this.#assertNotAborted();

    const directory = this.#resolve(inputPath, { allowGit: true });
    const details = await stat(directory).catch(() => null);

    if (!details?.isDirectory()) {
      throw new ToolError(
        `Not a directory: ${inputPath}`,
        "NOT_A_DIRECTORY"
      );
    }

    const entries = await readdir(directory, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      })
      .slice(0, 300);

    if (visible.length === 0) {
      return "(empty directory)";
    }

    return visible
      .map((entry) => {
        const relative = path.posix.join(
          inputPath === "." ? "" : inputPath.replaceAll("\\", "/"),
          entry.name
        );

        return `${entry.isDirectory() ? "dir" : "file"} ${relative}${
          entry.isDirectory() ? "/" : ""
        }`;
      })
      .join("\n");
  }

  async search(input: {
    query: string;
    path?: string;
    maxResults?: number;
  }): Promise<string> {
    this.#assertNotAborted();

    const query = input.query.trim();

    if (!query) {
      throw new ToolError("Search query cannot be empty.", "INVALID_QUERY");
    }

    if (query.includes("\0")) {
      throw new ToolError("Search query cannot contain NUL bytes.");
    }

    const maxResults = Math.min(Math.max(input.maxResults ?? 100, 1), 300);
    const searchPath = input.path
      ? this.#relative(input.path)
      : ".";
    const args = [
      "grep",
      "-n",
      "-F",
      "--untracked",
      "--no-color",
      "-I",
      "--max-count",
      String(maxResults),
      "--",
      query,
      searchPath === "." ? "." : searchPath,
    ];

    const result = await this.#git(args, this.root, 30_000).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        // git grep exits 1 for "no matches", which is not a failure.
        if (message.includes("exit code 1")) {
          return { stdout: "", stderr: "" };
        }

        throw error;
      }
    );

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(0, maxResults);

    return lines.length > 0
      ? truncate(lines.join("\n"), 30_000)
      : "(no matches)";
  }

  async writeFile(input: { path: string; content: string }): Promise<string> {
    this.#assertNotAborted();

    if (Buffer.byteLength(input.content, "utf8") > MAX_FILE_BYTES) {
      throw new ToolError(
        `Refusing to write more than ${MAX_FILE_BYTES} bytes in one call.`,
        "FILE_TOO_LARGE"
      );
    }

    const file = this.#resolve(input.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, input.content, "utf8");

    return `Wrote ${Buffer.byteLength(input.content, "utf8")} bytes to ${
      input.path
    }.`;
  }

  async applyPatch(input: { patch: string }): Promise<string> {
    this.#assertNotAborted();

    if (!input.patch.trim()) {
      throw new ToolError("Patch cannot be empty.", "EMPTY_PATCH");
    }

    if (Buffer.byteLength(input.patch, "utf8") > MAX_PATCH_BYTES) {
      throw new ToolError("Patch is too large.", "PATCH_TOO_LARGE");
    }

    this.#validatePatchPaths(input.patch);

    const directory = await mkdtemp(path.join(tmpdir(), "taskfleet-patch-"));
    const patchFile = path.join(directory, "change.patch");

    try {
      await writeFile(patchFile, input.patch, "utf8");
      await this.#git(
        ["apply", "--check", "--recount", "--whitespace=nowarn", patchFile],
        this.root,
        30_000
      );
      await this.#git(
        ["apply", "--recount", "--whitespace=nowarn", patchFile],
        this.root,
        30_000
      );

      return "Patch applied successfully.";
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async runCommand(input: {
    command: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<CommandResult> {
    this.#assertNotAborted();

    const command = input.command.trim();
    const args = input.args ?? [];

    if (!this.#allowlist.has(command)) {
      throw new ToolError(
        `Command "${command}" is not allowlisted. Allowed: ${[
          ...this.#allowlist,
        ].join(", ")}`,
        "COMMAND_NOT_ALLOWED"
      );
    }

    if (args.some((arg) => arg.includes("\0"))) {
      throw new ToolError("Command arguments cannot contain NUL bytes.");
    }

    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? this.#commandTimeoutMs, 1_000),
      this.#commandTimeoutMs
    );

    return this.#spawnCommand(command, args, timeoutMs);
  }

  async status(): Promise<{ clean: boolean; files: string }> {
    const result = await this.#git(
      ["status", "--porcelain"],
      this.root,
      10_000
    );

    return {
      clean: result.stdout.trim().length === 0,
      files: result.stdout.trim(),
    };
  }

  #validatePatchPaths(patch: string): void {
    const paths = new Set<string>();

    for (const line of patch.split("\n")) {
      const match = /^(?:diff --git a\/|\+\+\+ b\/|--- a\/)(.+)$/.exec(line);

      if (match?.[1]) {
        paths.add(match[1].trim());
      }
    }

    if (paths.size === 0) {
      throw new ToolError(
        "Patch does not contain a recognizable unified diff.",
        "INVALID_PATCH"
      );
    }

    for (const candidate of paths) {
      if (
        candidate.startsWith("/") ||
        candidate.startsWith("../") ||
        candidate.includes("/../") ||
        candidate.split("/").includes(".git")
      ) {
        throw new ToolError(
          `Patch path escapes the workspace: ${candidate}`,
          "INVALID_PATCH_PATH"
        );
      }

      try {
        this.#jail.resolve(candidate);
      } catch (error: unknown) {
        if (error instanceof PathJailError) {
          throw new ToolError(error.message, error.code);
        }

        throw error;
      }
    }
  }

  #assertNotAborted(): void {
    if (this.#signal?.aborted) {
      throw new ToolError("The run was cancelled.", "CANCELLED");
    }
  }

  async #git(
    args: string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await run("git", args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      });
    } catch (error: unknown) {
      const failure = error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const detail =
        (failure.stderr ?? "") || (failure.stdout ?? "") || failure.message;

      throw new ToolError(
        `git ${args[0] ?? ""} failed${
          typeof failure.code === "number" ? ` (exit code ${failure.code})` : ""
        }: ${truncate(detail ?? "unknown error", 4_000)}`,
        "GIT_COMMAND_FAILED"
      );
    }
  }

  #spawnCommand(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<CommandResult> {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.root,
        shell: false,
        env: safeEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;

      const append = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString("utf8");

        return next.length > MAX_COMMAND_OUTPUT * 2
          ? next.slice(0, MAX_COMMAND_OUTPUT * 2)
          : next;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      const onAbort = () => {
        aborted = true;
        child.kill("SIGKILL");
      };

      this.#signal?.addEventListener("abort", onAbort, { once: true });

      child.once("error", (error) => {
        clearTimeout(timer);
        this.#signal?.removeEventListener("abort", onAbort);
        reject(
          new ToolError(
            `Failed to start "${command}": ${error.message}`,
            "COMMAND_START_FAILED"
          )
        );
      });

      child.once("close", (code) => {
        clearTimeout(timer);
        this.#signal?.removeEventListener("abort", onAbort);

        resolve({
          command,
          args,
          exitCode: code,
          stdout: truncate(stdout, MAX_COMMAND_OUTPUT),
          stderr: truncate(stderr, MAX_COMMAND_OUTPUT),
          durationMs: Date.now() - startedAt,
          timedOut,
          aborted,
        });
      });
    });
  }
}

function safeEnvironment(): NodeJS.ProcessEnv {
  // Never forward LLM/GitHub/AWS credentials into an agent command.
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
    CI: "true",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    NODE_ENV: "test",
    npm_config_yes: "true",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

function truncate(value: string, limit: number): string {
  return value.length > limit
    ? `${value.slice(0, limit)}\n[output truncated at ${limit} characters]`
    : value;
}
