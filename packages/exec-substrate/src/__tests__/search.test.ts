import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";

import { ExecutionSubstrate } from "../substrate.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ExecutionSubstrate search tool", () => {
  it("finds matching files in the workspace", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-substrate-"));
    tempDirs.push(workspaceRoot);
    await writeFile(join(workspaceRoot, "a.txt"), "TODO: first", "utf8");
    await writeFile(join(workspaceRoot, "b.txt"), "nothing", "utf8");

    const substrate = new ExecutionSubstrate();
    const result = await substrate.execute(
      {
        id: "action-1",
        type: "search",
        params: {
          query: "TODO"
        },
        createdAt: new Date()
      },
      {
        workspaceRoot,
        sessionId: "session-1",
        goalId: "goal-1",
        eventBus: new EventBus()
      }
    );

    expect(JSON.parse(result.output)).toEqual([
      {
        path: "a.txt",
        line: 1,
        content: "TODO: first"
      }
    ]);
  });
});

