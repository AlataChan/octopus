import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TraceReader } from "../trace-reader.js";
import { TraceWriter } from "../trace-writer.js";
import type { WorkEvent } from "../types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("KB adapter observability events", () => {
  it("round-trips all KB adapter event payloads through trace storage", async () => {
    const events: WorkEvent[] = [
      {
        id: "evt-kb-started",
        timestamp: new Date("2026-04-27T00:00:00.000Z"),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "kb.adapter.call.started",
        sourceLayer: "work-core",
        payload: {
          command: "lookup",
          vaultPathHash: "vault-hash",
          queryHash: "query-hash",
        },
      },
      {
        id: "evt-kb-completed",
        timestamp: new Date("2026-04-27T00:00:01.000Z"),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "kb.adapter.call.completed",
        sourceLayer: "work-core",
        payload: {
          command: "retrieve-bundle",
          durationMs: 42,
          octopusKbVersion: "unknown",
          schemaHash: "schema-hash",
          resultItemCount: 3,
        },
      },
      {
        id: "evt-kb-failed",
        timestamp: new Date("2026-04-27T00:00:02.000Z"),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "kb.adapter.call.failed",
        sourceLayer: "work-core",
        payload: {
          command: "neighbors",
          durationMs: 10,
          errorKind: "timeout",
          message: "octopus-kb timed out",
        },
      },
      {
        id: "evt-kb-unavailable",
        timestamp: new Date("2026-04-27T00:00:03.000Z"),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "kb.adapter.unavailable",
        sourceLayer: "work-core",
        payload: {
          reason: "octopus-kb is not installed",
        },
      },
    ];
    const dir = await mkdtemp(join(tmpdir(), "octopus-kb-events-"));
    tempDirs.push(dir);
    const writer = new TraceWriter(dir);
    const reader = new TraceReader(dir);

    for (const event of events) {
      await writer.append(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "kb.adapter.call.started",
      "kb.adapter.call.completed",
      "kb.adapter.call.failed",
      "kb.adapter.unavailable",
    ]);
    await expect(reader.read("session-1")).resolves.toEqual(events);
  });
});
