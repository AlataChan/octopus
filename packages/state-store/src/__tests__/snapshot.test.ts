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

describe("FileStateStore snapshots", () => {
  it("persists and reloads snapshots with runtime context", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-snapshot-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "Resume blocked work", namedGoalId: "daily-report" });
    const session = createWorkSession(goal);
    const snapshot = {
      schemaVersion: 2 as const,
      snapshotId: "snapshot-1",
      capturedAt: new Date("2026-03-17T00:00:00.000Z"),
      session: {
        ...session,
        state: "blocked" as const
      },
      runtimeContext: {
        pendingResults: [{ success: true, output: "ok" }],
        contextPayload: {
          workspaceSummary: "repo root"
        }
      }
    };

    await store.saveSnapshot(session.id, snapshot);
    const loaded = await store.loadSnapshot(session.id, snapshot.snapshotId);

    expect(loaded).toEqual(snapshot);
  });

  it("lists snapshots newest-first for restore selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-snapshot-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "Resume blocked work" });
    const session = createWorkSession(goal);

    await store.saveSnapshot(session.id, {
      schemaVersion: 2,
      snapshotId: "snapshot-older",
      capturedAt: new Date("2026-03-17T00:00:00.000Z"),
      session,
      runtimeContext: { pendingResults: [] }
    });
    await store.saveSnapshot(session.id, {
      schemaVersion: 2,
      snapshotId: "snapshot-newer",
      capturedAt: new Date("2026-03-17T01:00:00.000Z"),
      session,
      runtimeContext: { pendingResults: [] }
    });

    const snapshots = await store.listSnapshots(session.id);

    expect(snapshots.map((snapshot) => snapshot.snapshotId)).toEqual([
      "snapshot-newer",
      "snapshot-older"
    ]);
  });

  it("loads the latest snapshot when no snapshotId is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-snapshot-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "Resume latest snapshot" });
    const session = createWorkSession(goal);

    await store.saveSnapshot(session.id, {
      schemaVersion: 2,
      snapshotId: "snapshot-older",
      capturedAt: new Date("2026-03-17T00:00:00.000Z"),
      session,
      runtimeContext: { pendingResults: [] }
    });
    await store.saveSnapshot(session.id, {
      schemaVersion: 2,
      snapshotId: "snapshot-newer",
      capturedAt: new Date("2026-03-17T01:00:00.000Z"),
      session: {
        ...session,
        state: "blocked"
      },
      runtimeContext: {
        pendingResults: [{ success: true, output: "latest" }]
      }
    });

    const loaded = await store.loadSnapshot(session.id);

    expect(loaded?.snapshotId).toBe("snapshot-newer");
    expect(loaded?.runtimeContext.pendingResults[0]?.output).toBe("latest");
  });

  it("hydrates nested work session dates from snapshot storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-snapshot-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "Resume rich session" });
    const session = createWorkSession(goal);
    session.items.push({
      id: "item-1",
      sessionId: session.id,
      description: "Inspect repo",
      state: "active",
      observations: [],
      actions: [
        {
          id: "action-1",
          type: "read",
          params: { path: "README.md" },
          createdAt: new Date("2026-03-18T01:00:00.000Z")
        }
      ],
      verifications: [
        {
          id: "verification-1",
          method: "action:read",
          passed: true,
          evidence: "README loaded",
          createdAt: new Date("2026-03-18T01:01:00.000Z")
        }
      ],
      createdAt: new Date("2026-03-18T00:59:00.000Z")
    });
    session.observations.push({
      id: "observation-1",
      content: "Repo scanned",
      source: "test",
      createdAt: new Date("2026-03-18T01:02:00.000Z")
    });
    session.artifacts.push({
      id: "artifact-1",
      type: "document",
      path: "STATUS.md",
      description: "Status summary",
      createdAt: new Date("2026-03-18T01:03:00.000Z")
    });
    session.transitions.push({
      from: "created",
      to: "active",
      reason: "Started work",
      triggerEvent: "session.started",
      timestamp: new Date("2026-03-18T01:04:00.000Z")
    });

    const snapshot = {
      schemaVersion: 2 as const,
      snapshotId: "snapshot-rich",
      capturedAt: new Date("2026-03-18T01:05:00.000Z"),
      session,
      runtimeContext: {
        pendingResults: [{ success: true, output: "README loaded" }]
      }
    };

    await store.saveSnapshot(session.id, snapshot);
    const loaded = await store.loadSnapshot(session.id, snapshot.snapshotId);

    expect(loaded?.session.items[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.session.items[0]?.actions[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.session.items[0]?.verifications[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.session.observations[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.session.artifacts[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.session.transitions[0]?.timestamp).toBeInstanceOf(Date);
  });
});
