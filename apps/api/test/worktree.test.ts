import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  branchForTask,
  taskIdFromBranch,
  WorktreeService,
} from "../src/worktrees/worktree-service.js";

describe("WorktreeService", () => {
  let repository: string;
  let worktreesRoot: string;
  let service: WorktreeService;

  beforeAll(() => {
    const base = mkdtempSync(path.join(tmpdir(), "taskfleet-git-"));
    repository = path.join(base, "repo");
    worktreesRoot = path.join(base, "worktrees");

    execFileSync("git", ["init", "-q", repository]);
    execFileSync("git", ["config", "user.email", "test@taskfleet.dev"], {
      cwd: repository,
    });
    execFileSync("git", ["config", "user.name", "TaskFleet Test"], {
      cwd: repository,
    });
    writeFileSync(path.join(repository, "README.md"), "# fixture\n");
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: repository });

    service = new WorktreeService({
      repoRoot: repository,
      worktreesRoot,
    });
  });

  afterAll(() => {
    rmSync(path.dirname(repository), { recursive: true, force: true });
  });

  it("creates an isolated branch and worktree per task", async () => {
    expect(await service.isGitRepository()).toBe(true);

    const worktree = await service.create("task-abc");

    expect(worktree.branch).toBe("taskfleet/task-abc");
    expect(worktree.path).toBe(path.join(worktreesRoot, "task-abc"));
    expect(existsSync(path.join(worktree.path, "README.md"))).toBe(true);

    const listed = await service.list();
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-abc",
          branch: "taskfleet/task-abc",
        }),
      ])
    );

    const second = await service.create("task-def");
    expect(second.branch).toBe("taskfleet/task-def");
    expect((await service.list()).length).toBeGreaterThanOrEqual(2);

    await service.remove(worktree);
    expect(existsSync(worktree.path)).toBe(false);
  });

  it("rejects unsafe task ids", async () => {
    await expect(service.create("../escape")).rejects.toThrow(
      "Unsafe task id"
    );
  });

  it("maps branches back to task ids", () => {
    expect(branchForTask("abc")).toBe("taskfleet/abc");
    expect(taskIdFromBranch("taskfleet/abc")).toBe("abc");
    expect(taskIdFromBranch("feature/nope")).toBeNull();
    expect(taskIdFromBranch("taskfleet/")).toBeNull();
  });

  it("creates per-run worktrees, diffs, commits and resets changes", async () => {
    const worktree = await service.ensureForRun("task-run", "run-one");

    expect(worktree.branch).toBe("taskfleet/run-one");
    expect(worktree.path).toBe(path.join(worktreesRoot, "run-one"));
    expect(existsSync(path.join(worktree.path, "README.md"))).toBe(true);

    writeFileSync(
      path.join(worktree.path, "AGENT_CHANGE.md"),
      "# agent change\n"
    );
    writeFileSync(path.join(worktree.path, "README.md"), "# changed\n");

    const diff = await service.diff(worktree);

    expect(diff.diff).toContain("AGENT_CHANGE.md");
    expect(diff.diff).toContain("+# agent change");
    expect(diff.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "AGENT_CHANGE.md", status: "added" }),
        expect.objectContaining({ path: "README.md", status: "modified" }),
      ])
    );

    const sha = await service.commit(worktree, "test commit");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await service.status(worktree)).clean).toBe(true);

    writeFileSync(path.join(worktree.path, "README.md"), "# dirty\n");
    await service.reset(worktree);
    expect((await service.status(worktree)).clean).toBe(true);

    await service.remove(worktree);
    expect(existsSync(worktree.path)).toBe(false);
  });

  it("refuses to remove a directory outside the worktrees root", async () => {
    await expect(
      service.remove({
        taskId: "task-x",
        branch: "taskfleet/task-x",
        path: repository,
      })
    ).rejects.toThrow("outside the worktrees root");
  });
});
