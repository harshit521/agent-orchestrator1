import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PathJail, PathJailError } from "../src/worktrees/path-jail.js";

describe("PathJail", () => {
  let base: string;
  let root: string;
  let jail: PathJail;

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "taskfleet-jail-"));
    root = path.join(base, "workspace");
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "index.ts"), "export const x = 1;\n");
    mkdirSync(path.join(base, "outside"));
    writeFileSync(path.join(base, "outside", "secret.txt"), "secret\n");
    symlinkSync(path.join(base, "outside"), path.join(root, "escape"));
    jail = new PathJail(root);
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("resolves relative paths inside the workspace", () => {
    expect(jail.resolve("src/index.ts")).toBe(
      path.join(root, "src", "index.ts")
    );
    expect(jail.resolve("new/dir/file.txt")).toBe(
      path.join(root, "new", "dir", "file.txt")
    );
    expect(jail.relative("src/index.ts")).toBe("src/index.ts");
  });

  it("rejects traversal, absolute paths and NUL bytes", () => {
    for (const candidate of [
      "../outside/secret.txt",
      "src/../../outside/secret.txt",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "src/\0index.ts",
      "",
    ]) {
      expect(() => jail.resolve(candidate)).toThrow(PathJailError);
    }
  });

  it("rejects the .git directory", () => {
    expect(() => jail.resolve(".git/config")).toThrow(/\.git directory/);
    expect(jail.resolve(".git/config", { allowGit: true })).toBe(
      path.join(root, ".git", "config")
    );
  });

  it("rejects symlink escapes", () => {
    expect(() => jail.resolve("escape/secret.txt")).toThrow(
      /outside the assigned workspace/
    );
  });
});
