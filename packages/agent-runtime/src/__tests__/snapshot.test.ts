import { describe, expect, it } from "vitest";

import type { SessionPlane, SessionSnapshot } from "../types.js";

describe("agent runtime snapshot contract", () => {
  it("supports full session snapshots and hydration on the session plane", async () => {
    const snapshot: SessionSnapshot = {
      schemaVersion: 2,
      snapshotId: "snapshot-1",
      capturedAt: new Date("2026-03-17T00:00:00.000Z"),
      session: {
        id: "session-1",
        goalId: "goal-1",
        namedGoalId: "daily-report",
        state: "blocked",
        items: [],
        observations: [],
        artifacts: [],
        transitions: [],
        createdAt: new Date("2026-03-17T00:00:00.000Z"),
        updatedAt: new Date("2026-03-17T00:00:00.000Z")
      },
      runtimeContext: {
        pendingResults: [{ success: true, output: "ok" }],
        contextPayload: {
          workspaceSummary: "repo root"
        }
      }
    };

    const plane: SessionPlane = {
      async initSession() {
        throw new Error("not needed");
      },
      async pauseSession() {},
      async resumeSession() {},
      async cancelSession() {},
      async snapshotSession() {
        return snapshot;
      },
      async hydrateSession(input) {
        return input.session;
      },
      async getMetadata() {
        return { runtimeType: "embedded" };
      }
    };

    await expect(plane.snapshotSession("session-1")).resolves.toEqual(snapshot);
    await expect(plane.hydrateSession(snapshot)).resolves.toEqual(snapshot.session);
  });
});
