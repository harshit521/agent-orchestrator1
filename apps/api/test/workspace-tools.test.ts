import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ToolError, WorkspaceTools } from "../src/agents/coding/tools.js";

describe("WorkspaceTools", () => {
  let root: string;
  let tools: WorkspaceTools;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "taskfleet-tools-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "index.ts"), "export const x = 1;\n");
    writeFileSync(path.join(root, "README.md"), "# fixture\n");
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["config", "user.email", "test@taskfleet.dev"], {
      cwd: root,
    });
    execFileSync("git", ["config", "user.name", "TaskFleet Test"], {
      cwd: root,
    });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    tools = new WorkspaceTools(root, {
      commandAllowlist: ["node", "npm"],
      commandTimeoutMs: 2_000,
    });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads, lists, searches, writes and patches files inside the worktree", async () => {
    expect(await tools.readFile({ path: "README.md" })).toContain("1: # fixture");

    const listing = await tools.listDirectory(".");
    expect(listing).toContain("dir src/");
    expect(listing).toContain("file README.md");
    expect(listing).not.toContain(".git");

    expect(await tools.search({ query: "export const x" })).toContain(
      "src/index.ts:1"
    );

    await tools.writeFile({ path: "src/new.ts", content: "export const y = 2;\n" });
    expect(readFileSync(path.join(root, "src", "new.ts"), "utf8")).toBe(
      "export const y = 2;\n"
    );

    const patch = [
      "diff --git a/src/index.ts b/src/index.ts",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1 +1,2 @@",
      " export const x = 1;",
      "+export const z = 3;",
      "",
    ].join("\n");

    expect(await tools.applyPatch({ patch })).toContain("applied");
    expect(readFileSync(path.join(root, "src", "index.ts"), "utf8")).toContain(
      "export const z = 3;"
    );
  });

  it("rejects traversal and absolute paths", async () => {
    await expect(tools.readFile({ path: "../outside.txt" })).rejects.toThrow(
      ToolError
    );
    await expect(tools.writeFile({ path: "/tmp/escape", content: "x" })).rejects.toThrow(
      ToolError
    );
    await expect(tools.readFile({ path: ".git/config" })).rejects.toThrow(
      /\.git directory/
    );
  });

  it("runs allowlisted commands with a sanitized environment", async () => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "super-secret-token";

    try {
      const result = await tools.runCommand({
        command: "node",
        args: ["-e", "console.log(process.env.GITHUB_TOKEN ?? 'missing')"],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("missing");
      expect(result.stderr).toBe("");
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previous;
      }
    }
  });

  it("rejects commands outside the allowlist", async () => {
    await expect(
      tools.runCommand({ command: "rm", args: ["-rf", "src"] })
    ).rejects.toThrow(/not allowlisted/);
  });

  it("enforces command timeouts", async () => {
    const result = await tools.runCommand({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 1_000,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("cancels commands when the run is aborted", async () => {
    const controller = new AbortController();
    const cancellable = new WorkspaceTools(root, {
      commandAllowlist: ["node"],
      commandTimeoutMs: 2_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(
      cancellable.runCommand({ command: "node", args: ["-e", "1"] })
    ).rejects.toThrow(/cancelled/i);
  });
});
