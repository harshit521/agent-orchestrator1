import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const BRANCH_PREFIX = "taskfleet/";
const SAFE_TASK_ID = /^[A-Za-z0-9_-]+$/;

export interface Worktree {
  taskId: string;
  branch: string;
  path: string;
}

export interface WorktreeServiceOptions {
  /** Repository the worktrees are created from. */
  repoRoot: string;
  /** Directory that holds the per-task worktrees. */
  worktreesRoot: string;
  gitBinary?: string;
}

export function branchForTask(taskId: string): string {
  return `${BRANCH_PREFIX}${taskId}`;
}

export function taskIdFromBranch(branch: string): string | null {
  if (!branch.startsWith(BRANCH_PREFIX)) {
    return null;
  }

  const taskId = branch.slice(BRANCH_PREFIX.length);

  return taskId.length > 0 ? taskId : null;
}

/**
 * One task -> one branch -> one worktree. This is the isolation primitive
 * that lets agents work on the same repository concurrently.
 */
export class WorktreeService {
  readonly #repoRoot: string;
  readonly #worktreesRoot: string;
  readonly #git: string;

  constructor(options: WorktreeServiceOptions) {
    this.#repoRoot = path.resolve(options.repoRoot);
    this.#worktreesRoot = path.resolve(options.worktreesRoot);
    this.#git = options.gitBinary ?? "git";
  }

  async create(taskId: string): Promise<Worktree> {
    if (!SAFE_TASK_ID.test(taskId)) {
      throw new Error(`Unsafe task id for a worktree: ${taskId}`);
    }

    const branch = branchForTask(taskId);
    const worktreePath = path.join(this.#worktreesRoot, taskId);

    await mkdir(this.#worktreesRoot, { recursive: true });
    await run(this.#git, ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
      cwd: this.#repoRoot,
    });

    return { taskId, branch, path: worktreePath };
  }

  async remove(worktree: Worktree): Promise<void> {
    await run(this.#git, ["worktree", "remove", "--force", worktree.path], {
      cwd: this.#repoRoot,
    });
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

      const taskId = taskIdFromBranch(currentBranch);

      if (taskId) {
        worktrees.push({ taskId, branch: currentBranch, path: currentPath });
      }

      currentPath = null;
      currentBranch = null;
    };

    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        flush();
        currentPath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        currentBranch = line
          .slice("branch ".length)
          .trim()
          .replace(/^refs\/heads\//, "");
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
}
