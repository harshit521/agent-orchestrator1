import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ScannerDefinition {
  id: string;
  label: string;
  command: string;
  args(target: string): string[];
  versionArgs: string[];
}

export type ScanStatus = "passed" | "failed" | "unavailable" | "error";

export interface ScannerResult {
  id: string;
  label: string;
  status: ScanStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
}

export interface SecurityScannerOptions {
  /** Directory scans are allowed to touch. */
  root: string;
  definitions?: ScannerDefinition[];
  timeoutMs?: number;
}

export const DEFAULT_SCANNERS: ScannerDefinition[] = [
  {
    id: "gitleaks",
    label: "Secret scanning (Gitleaks)",
    command: "gitleaks",
    args: (target) => ["detect", "--source", target, "--no-banner", "--redact"],
    versionArgs: ["version"],
  },
  {
    id: "semgrep",
    label: "Static analysis (Semgrep)",
    command: "semgrep",
    args: (target) => ["scan", "--quiet", "--json", target],
    versionArgs: ["--version"],
  },
  {
    id: "trivy",
    label: "Dependency scanning (Trivy)",
    command: "trivy",
    args: (target) => ["fs", "--quiet", target],
    versionArgs: ["--version"],
  },
];

/**
 * Runs the configured security tools against a directory. Missing tools are
 * reported as `unavailable` instead of failing the whole scan, which keeps the
 * gate usable on machines that only have some of them installed.
 */
export class SecurityScanner {
  readonly #root: string;
  readonly #definitions: ScannerDefinition[];
  readonly #timeoutMs: number;

  constructor(options: SecurityScannerOptions) {
    this.#root = path.resolve(options.root);
    this.#definitions = options.definitions ?? DEFAULT_SCANNERS;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  get root(): string {
    return this.#root;
  }

  /** Resolves a user-supplied path and rejects escapes from the root. */
  resolveTarget(target = "."): string {
    const resolved = path.resolve(this.#root, target);
    const relative = path.relative(this.#root, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Scan target must stay inside the project root.");
    }

    return resolved;
  }

  async availability(): Promise<Array<{ id: string; label: string; available: boolean }>> {
    return Promise.all(
      this.#definitions.map(async (definition) => ({
        id: definition.id,
        label: definition.label,
        available: await this.#isAvailable(definition),
      }))
    );
  }

  async scan(target = "."): Promise<ScannerResult[]> {
    const resolved = this.resolveTarget(target);

    return Promise.all(
      this.#definitions.map((definition) =>
        this.#runScanner(definition, resolved)
      )
    );
  }

  async #isAvailable(definition: ScannerDefinition): Promise<boolean> {
    try {
      await run(definition.command, definition.versionArgs, {
        timeout: 10_000,
      });

      return true;
    } catch {
      return false;
    }
  }

  async #runScanner(
    definition: ScannerDefinition,
    target: string
  ): Promise<ScannerResult> {
    const startedAt = Date.now();

    try {
      const { stdout, stderr } = await run(
        definition.command,
        definition.args(target),
        { timeout: this.#timeoutMs, maxBuffer: 10 * 1024 * 1024 }
      );

      return this.#result(definition, "passed", 0, startedAt, stdout + stderr);
    } catch (error: unknown) {
      const failure = error as {
        code?: string | number;
        stdout?: string;
        stderr?: string;
      };

      if (failure.code === "ENOENT") {
        return this.#result(
          definition,
          "unavailable",
          null,
          startedAt,
          `${definition.command} is not installed.`
        );
      }

      if (typeof failure.code === "number") {
        return this.#result(
          definition,
          failure.code === 0 ? "passed" : "failed",
          failure.code,
          startedAt,
          (failure.stdout ?? "") + (failure.stderr ?? "")
        );
      }

      return this.#result(
        definition,
        "error",
        null,
        startedAt,
        error instanceof Error ? error.message : "Scanner failed."
      );
    }
  }

  #result(
    definition: ScannerDefinition,
    status: ScanStatus,
    exitCode: number | null,
    startedAt: number,
    output: string
  ): ScannerResult {
    return {
      id: definition.id,
      label: definition.label,
      status,
      exitCode,
      durationMs: Date.now() - startedAt,
      output: output.slice(0, 4_000),
    };
  }
}
