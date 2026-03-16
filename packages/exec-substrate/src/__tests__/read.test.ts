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

describe("ExecutionSubstrate read tool", () => {
  it("reads workspace files and emits file.read", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-substrate-"));
    tempDirs.push(workspaceRoot);
    await writeFile(join(workspaceRoot, "README.md"), "hello world", "utf8");

    const eventBus = new EventBus();
    const events: string[] = [];
    eventBus.on("file.read", (event) => {
      events.push(event.type);
    });

    const substrate = new ExecutionSubstrate();
    const result = await substrate.execute(
      {
        id: "action-1",
        type: "read",
        params: {
          path: "README.md",
          encoding: "utf8"
        },
        createdAt: new Date()
      },
      {
        workspaceRoot,
        sessionId: "session-1",
        goalId: "goal-1",
        eventBus
      }
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe("hello world");
    expect(events).toEqual(["file.read"]);
  });

  it("rejects paths that escape the workspace", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-substrate-"));
    tempDirs.push(workspaceRoot);

    const substrate = new ExecutionSubstrate();

    await expect(
      substrate.execute(
        {
          id: "action-1",
          type: "read",
          params: {
            path: "../outside.txt",
            encoding: "utf8"
          },
          createdAt: new Date()
        },
        {
          workspaceRoot,
          sessionId: "session-1",
          goalId: "goal-1",
          eventBus: new EventBus()
        }
      )
    ).rejects.toThrow(/workspace/i);
  });
});

