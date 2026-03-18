import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileWorkspaceLock } from "../workspace-lock.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FileWorkspaceLock", () => {
  it("acquires and releases a workspace lock file", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-lock-"));
    tempDirs.push(workspaceRoot);
    const lock = new FileWorkspaceLock({ currentPid: () => 1234, isPidActive: () => true });

    await lock.acquire(workspaceRoot, "session-1");
    const file = await readFile(join(workspaceRoot, ".octopus", "workspace.lock"), "utf8");

    expect(file).toContain('"sessionId":"session-1"');
    expect(await lock.isHeld(workspaceRoot)).toBe(true);

    await lock.release(workspaceRoot, "session-1", "completed");

    expect(await lock.isHeld(workspaceRoot)).toBe(false);
  });

  it("clears stale lock files before a new acquire", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-lock-"));
    tempDirs.push(workspaceRoot);
    const lockPath = join(workspaceRoot, ".octopus", "workspace.lock");
    await mkdir(join(workspaceRoot, ".octopus"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ sessionId: "old", pid: 9999, acquiredAt: new Date("2026-03-18T00:00:00.000Z").toISOString() }),
      "utf8"
    );

    const lock = new FileWorkspaceLock({ currentPid: () => 1234, isPidActive: () => false });

    expect(await lock.clearStale(workspaceRoot)).toBe(true);
    expect(await lock.isHeld(workspaceRoot)).toBe(false);

    await lock.acquire(workspaceRoot, "session-2");

    const file = await readFile(lockPath, "utf8");
    expect(file).toContain('"sessionId":"session-2"');
  });
});
