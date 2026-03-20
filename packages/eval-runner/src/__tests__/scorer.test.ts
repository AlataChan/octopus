import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkSession } from "@octopus/work-contracts";
import { evaluateAssertions } from "../scorer.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: "test-session",
    goalId: "test-goal",
    state: "completed",
    items: [],
    observations: [],
    artifacts: [],
    transitions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("evaluateAssertions", () => {
  it("file-exists passes when file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "output.txt"), "hello", "utf8");
    const results = await evaluateAssertions(
      [{ type: "file-exists", path: "output.txt" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(true);
  });

  it("file-exists fails when file missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    const results = await evaluateAssertions(
      [{ type: "file-exists", path: "missing.txt" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(false);
  });

  it("file-contains passes when pattern found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "out.txt"), "hello world", "utf8");
    const results = await evaluateAssertions(
      [{ type: "file-contains", path: "out.txt", pattern: "world" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(true);
  });

  it("file-contains fails when pattern not found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "out.txt"), "hello", "utf8");
    const results = await evaluateAssertions(
      [{ type: "file-contains", path: "out.txt", pattern: "world" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(false);
  });

  it("file-matches passes on exact match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "out.txt"), "exact content", "utf8");
    const results = await evaluateAssertions(
      [{ type: "file-matches", path: "out.txt", expected: "exact content" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(true);
  });

  it("file-matches fails when trailing whitespace differs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "out.txt"), "exact content\n", "utf8");
    const results = await evaluateAssertions(
      [{ type: "file-matches", path: "out.txt", expected: "exact content" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(false);
  });

  it("file-exists rejects path traversal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    expect(() => evaluateAssertions(
      [{ type: "file-exists", path: "../../../etc/passwd" }],
      { workspaceRoot: dir, session: makeSession() }
    )).rejects.toThrow("escapes workspace");
  });

  it("shell-passes passes on exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    const results = await evaluateAssertions(
      [{ type: "shell-passes", command: "true" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(true);
  });

  it("shell-passes fails on non-zero exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-scorer-"));
    tempDirs.push(dir);
    const results = await evaluateAssertions(
      [{ type: "shell-passes", command: "false" }],
      { workspaceRoot: dir, session: makeSession() }
    );
    expect(results[0].passed).toBe(false);
  });

  it("session-completed passes when state is completed", async () => {
    const results = await evaluateAssertions(
      [{ type: "session-completed" }],
      { workspaceRoot: "/tmp", session: makeSession({ state: "completed" }) }
    );
    expect(results[0].passed).toBe(true);
  });

  it("session-completed fails when state is blocked", async () => {
    const results = await evaluateAssertions(
      [{ type: "session-completed" }],
      { workspaceRoot: "/tmp", session: makeSession({ state: "blocked" }) }
    );
    expect(results[0].passed).toBe(false);
  });

  it("no-blocked passes when no blocked transitions", async () => {
    const results = await evaluateAssertions(
      [{ type: "no-blocked" }],
      { workspaceRoot: "/tmp", session: makeSession({ transitions: [] }) }
    );
    expect(results[0].passed).toBe(true);
  });

  it("no-blocked fails when blocked transition exists", async () => {
    const results = await evaluateAssertions(
      [{ type: "no-blocked" }],
      { workspaceRoot: "/tmp", session: makeSession({
        transitions: [{ from: "active", to: "blocked", reason: "x", triggerEvent: "y", timestamp: new Date() }]
      }) }
    );
    expect(results[0].passed).toBe(false);
  });

  it("artifact-count passes when enough artifacts", async () => {
    const results = await evaluateAssertions(
      [{ type: "artifact-count", min: 1 }],
      { workspaceRoot: "/tmp", session: makeSession({
        artifacts: [{ id: "a", type: "document", path: "x", description: "y", createdAt: new Date() }]
      }) }
    );
    expect(results[0].passed).toBe(true);
  });

  it("artifact-count fails when not enough", async () => {
    const results = await evaluateAssertions(
      [{ type: "artifact-count", min: 3 }],
      { workspaceRoot: "/tmp", session: makeSession({ artifacts: [] }) }
    );
    expect(results[0].passed).toBe(false);
  });
});
