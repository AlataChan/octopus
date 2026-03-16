import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { FileStateStore } from "../store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FileStateStore", () => {
  it("persists and loads sessions with items stored separately", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-state-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "Persist state" });
    const session = createWorkSession(goal);
    session.items.push({
      id: "item-1",
      sessionId: session.id,
      description: "Check persistence",
      state: "pending",
      observations: [],
      actions: [],
      verifications: [],
      createdAt: new Date("2026-03-16T00:00:00.000Z")
    });

    await store.saveSession(session);
    const loaded = await store.loadSession(session.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.items[0]?.description).toBe("Check persistence");
    expect(loaded?.createdAt).toBeInstanceOf(Date);
  });

  it("lists saved sessions and round-trips artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-state-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "List sessions" });
    const session = createWorkSession(goal);
    const artifact = {
      id: "artifact-1",
      type: "document" as const,
      path: "STATUS.md",
      description: "Status summary",
      createdAt: new Date("2026-03-16T00:00:00.000Z")
    };

    await store.saveSession(session);
    await store.saveArtifact(session.id, artifact);

    const sessions = await store.listSessions();
    const artifacts = await store.loadArtifacts(session.id);

    expect(sessions).toEqual([
      {
        id: session.id,
        goalId: goal.id,
        state: "created",
        updatedAt: session.updatedAt
      }
    ]);
    expect(artifacts).toEqual([artifact]);
  });
});
