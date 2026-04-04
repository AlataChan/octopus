import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import type { Action } from "@octopus/work-contracts";

import { ExecutionSubstrate } from "../substrate.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Shell Progress", () => {
  it("calls onProgress with stdout chunks during shell execution", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-progress-"));
    tempDirs.push(workspaceRoot);

    const chunks: Array<{ stream: string; chunk: string }> = [];
    const substrate = new ExecutionSubstrate();
    const action: Action = {
      id: "test-echo",
      type: "shell",
      params: { executable: "echo", args: ["hello world"] },
      createdAt: new Date()
    };

    await substrate.execute(action, {
      workspaceRoot,
      sessionId: "s1",
      goalId: "g1",
      eventBus: new EventBus(),
      onProgress: (stream, chunk) => {
        chunks.push({ stream, chunk });
      }
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((entry) => entry.stream === "stdout" && entry.chunk.includes("hello world"))).toBe(true);
  });

  it("does not crash when onProgress is not provided", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-progress-"));
    tempDirs.push(workspaceRoot);

    const substrate = new ExecutionSubstrate();
    const action: Action = {
      id: "test-echo",
      type: "shell",
      params: { executable: "echo", args: ["no callback"] },
      createdAt: new Date()
    };

    const result = await substrate.execute(action, {
      workspaceRoot,
      sessionId: "s1",
      goalId: "g1",
      eventBus: new EventBus()
    });

    expect(result.success).toBe(true);
  });
});
