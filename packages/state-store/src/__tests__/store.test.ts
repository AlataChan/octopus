import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      actions: [
        {
          id: "action-1",
          type: "read",
          params: { path: "README.md" },
          createdAt: new Date("2026-03-18T00:01:00.000Z")
        }
      ],
      verifications: [
        {
          id: "verification-1",
          method: "action:read",
          passed: true,
          evidence: "README loaded",
          createdAt: new Date("2026-03-18T00:02:00.000Z")
        }
      ],
      createdAt: new Date("2026-03-16T00:00:00.000Z")
    });
    session.observations.push({
      id: "observation-1",
      content: "Repo scanned",
      source: "test",
      createdAt: new Date("2026-03-18T00:03:00.000Z")
    });
    session.transitions.push({
      from: "created",
      to: "active",
      reason: "Started work",
      triggerEvent: "session.started",
      timestamp: new Date("2026-03-18T00:04:00.000Z")
    });
    session.artifacts.push({
      id: "artifact-1",
      type: "document",
      path: "STATUS.md",
      description: "Status summary",
      createdAt: new Date("2026-03-18T00:05:00.000Z")
    });

    await store.saveSession(session);
    const loaded = await store.loadSession(session.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.items[0]?.description).toBe("Check persistence");
    expect(loaded?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.items[0]?.actions[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.items[0]?.verifications[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.observations[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.artifacts[0]?.createdAt).toBeInstanceOf(Date);
    expect(loaded?.transitions[0]?.timestamp).toBeInstanceOf(Date);
    expect(loaded?.workspaceId).toBe("default");
    expect(loaded?.configProfileId).toBe("default");
    expect("namedGoalId" in (loaded ?? {})).toBe(false);
  });

  it("lists saved sessions and round-trips artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-state-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "List sessions", namedGoalId: "daily-report" });
    const session = createWorkSession(goal, {
      workspaceId: "workspace-a",
      configProfileId: "profile-a",
      createdBy: "operator-1",
      taskTitle: "日报任务"
    });
    session.goalSummary = "List sessions";
    const artifact = {
      id: "artifact-1",
      type: "document" as const,
      path: "STATUS.md",
      description: "Status summary",
      createdAt: new Date("2026-03-16T00:00:00.000Z")
    };

    expect(session.namedGoalId).toBe("daily-report");
    await store.saveSession(session);
    await store.saveArtifact(session.id, artifact);

    const sessions = await store.listSessions();
    const artifacts = await store.loadArtifacts(session.id);

    expect(sessions).toEqual([
      {
        id: session.id,
        goalId: goal.id,
        workspaceId: "workspace-a",
        configProfileId: "profile-a",
        createdBy: "operator-1",
        taskTitle: "日报任务",
        namedGoalId: "daily-report",
        goalSummary: "List sessions",
        state: "created",
        updatedAt: session.updatedAt
      }
    ]);
    expect(artifacts).toEqual([artifact]);
  });

  it("loads older stored sessions without goalSummary", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-state-"));
    tempDirs.push(root);

    const store = new FileStateStore(root);
    const goal = createWorkGoal({ description: "Legacy session" });
    const session = createWorkSession(goal);

    await store.saveSession(session);

    const sessionPath = join(root, "sessions", session.id, "session.json");
    const raw = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>;
    delete raw.goalSummary;
    await writeFile(sessionPath, JSON.stringify(raw, null, 2));

    const loaded = await store.loadSession(session.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.goalSummary).toBeUndefined();
    expect(loaded?.workspaceId).toBe("default");
    expect(loaded?.configProfileId).toBe("default");
  });
});
