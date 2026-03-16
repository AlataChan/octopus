import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";

import { ExecutionSubstrate } from "../substrate.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ExecutionSubstrate shell tool", () => {
  it("executes commands via spawn and emits command.executed", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-substrate-"));
    tempDirs.push(workspaceRoot);

    const eventBus = new EventBus();
    const events: string[] = [];
    eventBus.on("command.executed", (event) => {
      events.push(event.type);
    });

    const substrate = new ExecutionSubstrate();
    const result = await substrate.execute(
      {
        id: "action-1",
        type: "shell",
        params: {
          executable: process.execPath,
          args: ["-e", "process.stdout.write('ok')"],
          timeoutMs: 5_000
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
    expect(result.output).toBe("ok");
    expect(events).toEqual(["command.executed"]);
  });
});
