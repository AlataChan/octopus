import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PendingStore } from "../pending-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PendingStore", () => {
  it("saves, loads, and removes pending notifications", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-surfaces-chat-"));
    tempDirs.push(dir);
    const store = new PendingStore(join(dir, "pending.json"));

    store.save({
      sessionId: "session-1",
      responseUrl: "https://hooks.slack.com/commands/1",
      channelId: "C123",
      goalDescription: "Clean up",
      submittedAt: "2026-03-19T00:00:00.000Z"
    });

    expect(store.loadAll()).toEqual([
      {
        sessionId: "session-1",
        responseUrl: "https://hooks.slack.com/commands/1",
        channelId: "C123",
        goalDescription: "Clean up",
        submittedAt: "2026-03-19T00:00:00.000Z"
      }
    ]);

    store.remove("session-1");

    expect(store.loadAll()).toEqual([]);
  });
});
