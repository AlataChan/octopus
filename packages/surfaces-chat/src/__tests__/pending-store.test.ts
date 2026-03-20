import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

    await store.save({
      sessionId: "session-1",
      callbackUrl: "https://example.com/callback/1",
      channelId: "C123",
      goalDescription: "Clean up",
      submittedAt: "2026-03-19T00:00:00.000Z"
    });

    expect(await store.loadAll()).toEqual([
      {
        sessionId: "session-1",
        callbackUrl: "https://example.com/callback/1",
        channelId: "C123",
        goalDescription: "Clean up",
        submittedAt: "2026-03-19T00:00:00.000Z"
      }
    ]);

    await store.remove("session-1");

    expect(await store.loadAll()).toEqual([]);
  });

  it("serializes concurrent saves so earlier entries are not overwritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-surfaces-chat-"));
    tempDirs.push(dir);
    const store = new PendingStore(join(dir, "pending.json"));
    const storeHarness = store as unknown as {
      write(entries: Awaited<ReturnType<PendingStore["loadAll"]>>): Promise<void>;
    };
    const originalWrite = storeHarness.write.bind(storeHarness);
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      storeHarness.write = vi.fn(async (entries: Awaited<ReturnType<PendingStore["loadAll"]>>) => {
        if (!releaseFirstWrite) {
          await new Promise<void>((release) => {
            releaseFirstWrite = release;
            resolve();
          });
        }
        await originalWrite(entries);
      });
    });

    const firstEntry = {
      sessionId: "session-1",
      callbackUrl: "https://example.com/callback/1",
      channelId: "C123",
      goalDescription: "Clean up",
      submittedAt: "2026-03-19T00:00:00.000Z"
    };
    const secondEntry = {
      sessionId: "session-2",
      callbackUrl: "https://example.com/callback/2",
      channelId: "C456",
      goalDescription: "Deploy docs",
      submittedAt: "2026-03-19T00:01:00.000Z"
    };

    const saveFirst = store.save(firstEntry);
    await firstWriteStarted;
    const saveSecond = store.save(secondEntry);
    releaseFirstWrite?.();

    await Promise.all([saveFirst, saveSecond]);

    expect(await store.loadAll()).toEqual([firstEntry, secondEntry]);
  });
});
