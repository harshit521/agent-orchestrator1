import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export class PathJailError extends Error {
  readonly code = "PATH_OUTSIDE_WORKSPACE";

  constructor(message: string) {
    super(message);
    this.name = "PathJailError";
  }
}

/**
 * Resolves every agent-supplied path against one workspace root. Absolute
 * paths, `..` traversal, NUL bytes, symlink escapes and writes into `.git` are
 * rejected before the filesystem is touched.
 */
export class PathJail {
  readonly root: string;
  readonly #realRoot: string;

  constructor(root: string) {
    this.root = path.resolve(root);

    if (!existsSync(this.root)) {
      throw new PathJailError(`Workspace does not exist: ${this.root}`);
    }

    this.#realRoot = realpathSync(this.root);
  }

  /** Resolves a relative path inside the workspace, or throws. */
  resolve(input: string, options: { allowGit?: boolean } = {}): string {
    if (typeof input !== "string" || input.trim().length === 0) {
      throw new PathJailError("A non-empty relative path is required.");
    }

    if (input.includes("\0")) {
      throw new PathJailError("Paths cannot contain NUL bytes.");
    }

    const normalised = input.replaceAll("\\", "/");

    if (
      path.posix.isAbsolute(normalised) ||
      /^[A-Za-z]:\//.test(normalised)
    ) {
      throw new PathJailError(
        `Absolute paths are not allowed inside the workspace: ${input}`
      );
    }

    const resolved = path.resolve(this.root, normalised);

    this.#assertInside(resolved);

    const relative = path.relative(this.root, resolved);
    const segments = relative.split(path.sep);

    if (!options.allowGit && segments[0] === ".git") {
      throw new PathJailError("The .git directory is not accessible to agents.");
    }

    this.#assertNoSymlinkEscape(resolved);

    return resolved;
  }

  relative(input: string): string {
    const relative = path.relative(this.root, this.resolve(input));

    return relative.length > 0 ? relative.split(path.sep).join("/") : ".";
  }

  /** Rejects any path that escapes either lexically or through a symlink. */
  #assertInside(candidate: string): void {
    const relative = path.relative(this.root, candidate);

    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new PathJailError(
        `Path escapes the assigned workspace: ${candidate}`
      );
    }
  }

  #assertNoSymlinkEscape(candidate: string): void {
    let current = candidate;

    while (!existsSync(current)) {
      const parent = path.dirname(current);

      if (parent === current) {
        break;
      }

      current = parent;
    }

    let real: string;

    try {
      real = realpathSync(current);
    } catch {
      throw new PathJailError(`Cannot resolve workspace path: ${candidate}`);
    }

    const relative = path.relative(this.#realRoot, real);

    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new PathJailError(
        `Path resolves outside the assigned workspace through a symlink: ${candidate}`
      );
    }
  }
}
