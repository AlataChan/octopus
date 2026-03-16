import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";

import { ExecutionSubstrate } from "../substrate.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ExecutionSubstrate patch tool", () => {
  it("writes files and emits file.patched", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-substrate-"));
    tempDirs.push(workspaceRoot);

    const eventBus = new EventBus();
    const events: string[] = [];
    eventBus.on("file.patched", (event) => {
      events.push(event.type);
    });

    const substrate = new ExecutionSubstrate();
    const result = await substrate.execute(
      {
        id: "action-1",
        type: "patch",
        params: {
          path: "notes.txt",
          content: "persist me"
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
    expect(await readFile(join(workspaceRoot, "notes.txt"), "utf8")).toBe("persist me");
    expect(events).toEqual(["file.patched"]);
  });

  it("rejects writes that escape the workspace root", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-substrate-"));
    tempDirs.push(workspaceRoot);

    const substrate = new ExecutionSubstrate();

    await expect(
      substrate.execute(
        {
          id: "action-escape",
          type: "patch",
          params: {
            path: "../escape.txt",
            content: "should fail"
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
    ).rejects.toThrow(/workspace boundary/i);
  });
});
