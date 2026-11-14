import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SecurityScanner,
  type ScannerDefinition,
} from "../src/security/scanner.js";

const definitions: ScannerDefinition[] = [
  {
    id: "ok",
    label: "Passing scanner",
    command: process.execPath,
    args: () => ["-e", "process.exit(0)"],
    versionArgs: ["--version"],
  },
  {
    id: "findings",
    label: "Failing scanner",
    command: process.execPath,
    args: () => ["-e", "console.log('secret found'); process.exit(1)"],
    versionArgs: ["--version"],
  },
  {
    id: "missing",
    label: "Missing tool",
    command: "taskfleet-missing-tool-xyz",
    args: () => [],
    versionArgs: ["--version"],
  },
];

describe("SecurityScanner", () => {
  let root: string;
  let scanner: SecurityScanner;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "taskfleet-scan-"));
    scanner = new SecurityScanner({ root, definitions, timeoutMs: 10_000 });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports passed, failed and unavailable tools independently", async () => {
    const results = await scanner.scan();

    expect(results.map((result) => [result.id, result.status])).toEqual([
      ["ok", "passed"],
      ["findings", "failed"],
      ["missing", "unavailable"],
    ]);
    expect(results[1]?.exitCode).toBe(1);
    expect(results[1]?.output).toContain("secret found");
  });

  it("reports tool availability", async () => {
    const tools = await scanner.availability();

    expect(tools).toEqual([
      { id: "ok", label: "Passing scanner", available: true },
      { id: "findings", label: "Failing scanner", available: true },
      { id: "missing", label: "Missing tool", available: false },
    ]);
  });

  it("rejects targets outside the root", () => {
    expect(() => scanner.resolveTarget("../etc")).toThrow(
      "must stay inside the project root"
    );
    expect(scanner.resolveTarget(".")).toBe(root);
  });
});
