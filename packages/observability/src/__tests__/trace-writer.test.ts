import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TraceReader } from "../trace-reader.js";
import { TraceWriter } from "../trace-writer.js";
import type { WorkEvent } from "../types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
    })
  );
});

describe("TraceWriter", () => {
  it("persists newline-delimited events that TraceReader can replay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-trace-"));
    tempDirs.push(dir);

    const writer = new TraceWriter(dir);
    const reader = new TraceReader(dir);
    const event: WorkEvent = {
      id: "evt-1",
      timestamp: new Date("2026-03-16T00:00:00.000Z"),
      sessionId: "session-1",
      goalId: "goal-1",
      type: "command.executed",
      sourceLayer: "substrate",
      payload: {
        executable: "git",
        args: ["status"],
        cwd: "/workspace",
        exitCode: 0,
        durationMs: 12,
        timedOut: false
      }
    };

    await writer.append(event);

    const jsonl = await readFile(join(dir, "session-1.jsonl"), "utf8");
    const events = await reader.read("session-1");

    expect(jsonl.trim().split("\n")).toHaveLength(1);
    expect(events).toEqual([event]);
  });
});

