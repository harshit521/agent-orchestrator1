import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface TestCommand {
  command: string;
  args: string[];
  source: "configured" | "detected";
}

export interface TestRunResult {
  status: "passed" | "failed" | "skipped" | "error";
  command: string | null;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  reason?: string;
}

const MAX_OUTPUT = 40_000;

/**
 * Parses a trusted, operator-supplied command string without invoking a shell.
 * Quotes are supported so `npm test -- --run` works as expected.
 */
export function parseCommandLine(value: string): TestCommand | null {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const token = match[1] ?? match[2] ?? match[3];
    const value = token?.trim();

    if (value) {
      tokens.push(value);
    }
  }

  const [command, ...args] = tokens;

  return command ? { command, args, source: "configured" } : null;
}

/** Picks a sensible default test command for the repository under test. */
export function detectTestCommand(root: string): TestCommand | null {
  const packageJson = path.join(root, "package.json");

  if (existsSync(packageJson)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const testScript = parsed.scripts?.test;

      if (
        typeof testScript === "string" &&
        testScript.trim().length > 0 &&
        !/no test specified/i.test(testScript)
      ) {
        return { command: "npm", args: ["test"], source: "detected" };
      }
    } catch {
      // A malformed package.json should not crash the run; keep detecting.
    }
  }

  if (
    existsSync(path.join(root, "pyproject.toml")) ||
    existsSync(path.join(root, "pytest.ini")) ||
    existsSync(path.join(root, "tests"))
  ) {
    return {
      command: "python3",
      args: ["-m", "pytest", "-q"],
      source: "detected",
    };
  }

  if (existsSync(path.join(root, "go.mod"))) {
    return { command: "go", args: ["test", "./..."], source: "detected" };
  }

  if (existsSync(path.join(root, "Cargo.toml"))) {
    return { command: "cargo", args: ["test", "--quiet"], source: "detected" };
  }

  return null;
}

export async function resolveTestCommand(
  root: string,
  configured?: string
): Promise<TestCommand | null> {
  if (configured) {
    return parseCommandLine(configured);
  }

  return detectTestCommand(root);
}

export function runTests(
  root: string,
  command: TestCommand,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<TestRunResult> {
  const startedAt = Date.now();

  if (options.signal?.aborted) {
    return Promise.resolve({
      status: "skipped",
      command: command.command,
      args: command.args,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      timedOut: false,
      aborted: true,
      reason: "The run was cancelled before tests started.",
    });
  }

  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: root,
      shell: false,
      env: testEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    const onAbort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        status: "error",
        command: command.command,
        args: command.args,
        exitCode: null,
        stdout: truncate(stdout),
        stderr: truncate(`${stderr}\n${error.message}`.trim()),
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        reason: error.message,
      });
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);

      resolve({
        status:
          aborted || timedOut
            ? "failed"
            : code === 0
              ? "passed"
              : "failed",
        command: command.command,
        args: command.args,
        exitCode: code,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        ...(timedOut
          ? { reason: `Tests timed out after ${options.timeoutMs}ms.` }
          : aborted
            ? { reason: "The run was cancelled while tests were running." }
            : {}),
      });
    });
  });
}

function testEnvironment(): NodeJS.ProcessEnv {
  // The test process gets toolchain paths but no LLM/GitHub credentials.
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    CI: "true",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    NODE_ENV: "test",
    npm_config_yes: "true",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

function append(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");

  return next.length > MAX_OUTPUT * 2 ? next.slice(0, MAX_OUTPUT * 2) : next;
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT
    ? `${value.slice(0, MAX_OUTPUT)}\n[output truncated at ${MAX_OUTPUT} characters]`
    : value;
}
