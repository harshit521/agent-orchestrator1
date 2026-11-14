import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const BRANCH_PREFIX = "taskfleet/";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const MAX_DIFF_CHARS = 200_000;

export interface Worktree {
  taskId: string;
  runId?: string;
  branch: string;
  path: string;
}

export interface WorktreeDiff {
  diff: string;
  files: ChangedFile[];
  truncated: boolean;
}

export type ChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "unknown";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  previousPath?: string;
}

export interface WorktreeServiceOptions {
  /** Repository the worktrees are created from. */
  repoRoot: string;
  /** Directory that holds the per-run worktrees. */
  worktreesRoot: string;
  gitBinary?: string;
  authorName?: string;
  authorEmail?: string;
}

export function branchForTask(taskId: string): string {
  return `${BRANCH_PREFIX}${taskId}`;
}

export function branchForRun(runId: string): string {
  return `${BRANCH_PREFIX}${runId}`;
}

/** Parses both legacy task branches and per-run branches. */
export function taskIdFromBranch(branch: string): string | null {
  if (!branch.startsWith(BRANCH_PREFIX)) {
    return null;
  }

  const taskId = branch.slice(BRANCH_PREFIX.length);

  return taskId.length > 0 ? taskId : null;
}

export function branchFromRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").trim();
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) {
    throw new Error(`Unsafe ${label} for a worktree: ${value}`);
  }
}

/**
 * One task/run -> one branch -> one worktree. Run worktrees use
 * `taskfleet/<runId>` so retries and concurrent runs never share files.
 */
export class WorktreeService {
  readonly #repoRoot: string;
  readonly #worktreesRoot: string;
  readonly #git: string;
  readonly #authorName: string;
  readonly #authorEmail: string;

  constructor(options: WorktreeServiceOptions) {
    this.#repoRoot = path.resolve(options.repoRoot);
    this.#worktreesRoot = path.resolve(options.worktreesRoot);
    this.#git = options.gitBinary ?? "git";
    this.#authorName = options.authorName ?? "TaskFleet Agent";
    this.#authorEmail = options.authorEmail ?? "agent@taskfleet.local";
  }

  get worktreesRoot(): string {
    return this.#worktreesRoot;
  }

  /** Legacy per-task worktree used by the integrations page and old tests. */
  async create(taskId: string): Promise<Worktree> {
    assertSafeId(taskId, "task id");

    const branch = branchForTask(taskId);
    const worktreePath = path.join(this.#worktreesRoot, taskId);

    await mkdir(this.#worktreesRoot, { recursive: true });

    if (existsSync(worktreePath)) {
      const worktree = { taskId, branch, path: worktreePath };
      await this.reset(worktree);

      return worktree;
    }

    if (await this.#branchExists(branch)) {
      await this.#gitRun(["worktree", "add", worktreePath, branch], this.#repoRoot);
    } else {
      await this.#gitRun(
        ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
        this.#repoRoot
      );
    }

    await this.#configureIdentity(worktreePath);

    return { taskId, branch, path: worktreePath };
  }

  /**
   * Idempotently creates or resets the worktree for a run. Safe to call after
   * an API restart because the branch and path are derived from the run id.
   */
  async ensureForRun(taskId: string, runId: string): Promise<Worktree> {
    assertSafeId(taskId, "task id");
    assertSafeId(runId, "run id");

    const branch = branchForRun(runId);
    const worktreePath = path.join(this.#worktreesRoot, runId);
    const worktree: Worktree = { taskId, runId, branch, path: worktreePath };

    await mkdir(this.#worktreesRoot, { recursive: true });

    if (existsSync(worktreePath)) {
      if (!(await this.#isWorktree(worktreePath))) {
        throw new Error(
          `Refusing to use a non-worktree directory: ${worktreePath}`
        );
      }

      await this.reset(worktree);

      return worktree;
    }

    if (await this.#branchExists(branch)) {
      await this.#gitRun(["worktree", "add", worktreePath, branch], this.#repoRoot);
    } else {
      await this.#gitRun(
        ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
        this.#repoRoot
      );
    }

    await this.#configureIdentity(worktreePath);

    return worktree;
  }

  /** Discards every uncommitted change in the worktree. */
  async reset(worktree: Worktree): Promise<void> {
    this.#assertManagedPath(worktree.path);

    if (!existsSync(worktree.path)) {
      throw new Error(`Worktree does not exist: ${worktree.path}`);
    }

    await this.#gitRun(["reset", "--hard", "HEAD"], worktree.path);
    await this.#gitRun(["clean", "-fd"], worktree.path);
  }

  /** Removes the worktree directory but keeps the branch for a pending PR. */
  async remove(worktree: Worktree): Promise<void> {
    this.#assertManagedPath(worktree.path);

    if (!existsSync(worktree.path)) {
      await this.#gitRun(["worktree", "prune"], this.#repoRoot).catch(() => {
        // Pruning is best effort when the directory is already gone.
      });
      return;
    }

    try {
      await this.#gitRun(
        ["worktree", "remove", "--force", worktree.path],
        this.#repoRoot
      );
    } catch {
      // A partially deleted directory can leave git metadata behind.
      await this.#gitRun(
        ["worktree", "remove", "--force", "--force", worktree.path],
        this.#repoRoot
      ).catch(async () => {
        await this.#gitRun(["worktree", "prune"], this.#repoRoot);
      });
    }
  }

  /** Stages all changes and returns a real unified diff plus file list. */
  async diff(worktree: Worktree): Promise<WorktreeDiff> {
    this.#assertManagedPath(worktree.path);

    await this.#gitRun(["add", "-A"], worktree.path);

    const [diffResult, nameStatus] = await Promise.all([
      this.#gitRun(
        ["diff", "--cached", "--no-color", "--no-ext-diff", "--binary"],
        worktree.path,
        { maxBuffer: 20 * 1024 * 1024 }
      ),
      this.#gitRun(
        ["diff", "--cached", "--name-status", "--no-renames"],
        worktree.path
      ),
    ]);

    const fullDiff = diffResult.stdout;
    const truncated = fullDiff.length > MAX_DIFF_CHARS;

    return {
      diff: truncated
        ? `${fullDiff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated]\n`
        : fullDiff,
      files: parseNameStatus(nameStatus.stdout),
      truncated,
    };
  }

  /** Commits the staged worktree and returns the commit SHA. */
  async commit(worktree: Worktree, message: string): Promise<string> {
    this.#assertManagedPath(worktree.path);

    await this.#gitRun(["add", "-A"], worktree.path);

    const status = await this.#gitRun(
      ["status", "--porcelain"],
      worktree.path
    );

    if (status.stdout.trim().length === 0) {
      throw new Error("There are no changes to commit.");
    }

    await this.#gitRun(["commit", "-m", message], worktree.path, {
      env: {
        GIT_AUTHOR_NAME: this.#authorName,
        GIT_AUTHOR_EMAIL: this.#authorEmail,
        GIT_COMMITTER_NAME: this.#authorName,
        GIT_COMMITTER_EMAIL: this.#authorEmail,
      },
    });

    const revision = await this.#gitRun(
      ["rev-parse", "HEAD"],
      worktree.path
    );

    return revision.stdout.trim();
  }

  /**
   * Pushes the current HEAD to the run branch. The token is injected into the
   * remote URL for this command only and is removed from error messages.
   */
  async push(
    worktree: Worktree,
    options: { remoteUrl: string; token: string; branch?: string }
  ): Promise<void> {
    this.#assertManagedPath(worktree.path);

    const branch = options.branch ?? worktree.branch;
    const authenticated = authenticatedRemote(options.remoteUrl, options.token);

    try {
      await this.#gitRun(
        ["push", authenticated, `HEAD:refs/heads/${branch}`],
        worktree.path,
        { redact: [options.token, authenticated] }
      );
    } catch (error: unknown) {
      throw new Error(redactSecrets(error instanceof Error ? error.message : String(error), [
        options.token,
        authenticated,
      ]));
    }
  }

  async status(worktree: Worktree): Promise<{
    clean: boolean;
    branch: string;
    files: ChangedFile[];
  }> {
    this.#assertManagedPath(worktree.path);

    const branch = await this.#gitRun(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      worktree.path
    );
    const status = await this.#gitRun(
      ["status", "--porcelain"],
      worktree.path
    );

    return {
      clean: status.stdout.trim().length === 0,
      branch: branchFromRef(branch.stdout),
      files: parseNameStatus(status.stdout),
    };
  }

  async list(): Promise<Worktree[]> {
    const { stdout } = await run(
      this.#git,
      ["worktree", "list", "--porcelain"],
      { cwd: this.#repoRoot }
    );

    const worktrees: Worktree[] = [];
    let currentPath: string | null = null;
    let currentBranch: string | null = null;

    const flush = () => {
      if (!currentPath || !currentBranch) {
        currentPath = null;
        currentBranch = null;
        return;
      }

      if (currentBranch.startsWith(BRANCH_PREFIX)) {
        const id = currentBranch.slice(BRANCH_PREFIX.length);

        if (id.length > 0) {
          worktrees.push({
            taskId: id,
            ...(currentPath.startsWith(this.#worktreesRoot)
              ? { runId: path.basename(currentPath) }
              : {}),
            branch: currentBranch,
            path: currentPath,
          });
        }
      }

      currentPath = null;
      currentBranch = null;
    };

    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        flush();
        currentPath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        currentBranch = branchFromRef(line.slice("branch ".length));
      } else if (line.trim() === "") {
        flush();
      }
    }

    flush();

    return worktrees;
  }

  async isGitRepository(): Promise<boolean> {
    try {
      const { stdout } = await run(
        this.#git,
        ["rev-parse", "--is-inside-work-tree"],
        { cwd: this.#repoRoot }
      );

      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  async #isWorktree(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await run(
        this.#git,
        ["rev-parse", "--is-inside-work-tree"],
        { cwd: worktreePath }
      );

      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  async #branchExists(branch: string): Promise<boolean> {
    try {
      await this.#gitRun(
        ["rev-parse", "--verify", `refs/heads/${branch}`],
        this.#repoRoot
      );

      return true;
    } catch {
      return false;
    }
  }

  async #configureIdentity(worktreePath: string): Promise<void> {
    await this.#gitRun(
      ["config", "user.name", this.#authorName],
      worktreePath
    );
    await this.#gitRun(
      ["config", "user.email", this.#authorEmail],
      worktreePath
    );
  }

  #assertManagedPath(candidate: string): void {
    const resolved = path.resolve(candidate);
    const relative = path.relative(this.#worktreesRoot, resolved);

    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Refusing to operate outside the worktrees root: ${candidate}`);
    }
  }

  async #gitRun(
    args: string[],
    cwd: string,
    options: {
      maxBuffer?: number;
      env?: NodeJS.ProcessEnv;
      redact?: string[];
    } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await run(this.#git, args, {
        cwd,
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        env: {
          ...process.env,
          ...options.env,
          // Never allow a hook or credential prompt to block a run.
          GIT_TERMINAL_PROMPT: "0",
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const sanitized = options.redact?.length
        ? redactSecrets(message, options.redact)
        : message;

      throw new Error(sanitized);
    }
  }
}

export function parseNameStatus(output: string): ChangedFile[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [code = "?", ...parts] = line.split(/\s+/);
      const status = statusFromCode(code);
      const filename = parts.at(-1) ?? "";

      return {
        path: filename,
        status,
        ...(code.startsWith("R") && parts.length > 1
          ? { previousPath: parts[0] }
          : {}),
      };
    })
    .filter((file) => file.path.length > 0);
}

function statusFromCode(code: string): ChangeStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "unknown";
  }
}

export function authenticatedRemote(remoteUrl: string, token: string): string {
  const url = new URL(remoteUrl);

  if (url.protocol !== "https:") {
    throw new Error("GitHub remote URL must use HTTPS.");
  }

  url.username = "x-access-token";
  url.password = token;

  return url.toString();
}

export function githubRemoteUrl(repository: string): string {
  return `https://github.com/${repository}.git`;
}

export function redactSecrets(value: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) {
      return current;
    }

    return current.split(secret).join("[redacted]");
  }, value);
}
