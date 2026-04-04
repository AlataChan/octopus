import { describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import { createWorkGoal } from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";
import { allowAllPolicy, collectEvents, FakeRuntime, FakeSubstrate, MemoryStateStore } from "./helpers.js";

describe("WorkEngine resume", () => {
  it("hydrates from a stored snapshot and emits snapshot.restored without reinitializing the session", async () => {
    const eventBus = new EventBus();
    const events = collectEvents(eventBus);
    const store = new MemoryStateStore();
    const resumedGoal = createWorkGoal({ description: "Resume session" });
    const resumedSession = {
      id: "session-1",
      goalId: resumedGoal.id,
      workspaceId: "default",
      configProfileId: "default",
      state: "blocked" as const,
      items: [],
      observations: [],
      artifacts: [],
      transitions: [],
      createdAt: new Date("2026-03-18T00:00:00.000Z"),
      updatedAt: new Date("2026-03-18T00:00:00.000Z")
    };
    await store.saveSnapshot("session-1", {
      schemaVersion: 2,
      snapshotId: "snapshot-1",
      capturedAt: new Date("2026-03-18T01:00:00.000Z"),
      session: resumedSession,
      runtimeContext: {
        pendingResults: [{ success: true, output: "restored" }]
      }
    });

    const runtime = new FakeRuntime([{ kind: "completion", evidence: "restored" }]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      eventBus,
      allowAllPolicy()
    );

    const session = await engine.executeGoal(resumedGoal, {
      resumeFrom: { sessionId: "session-1", snapshotId: "snapshot-1" }
    });

    expect(session.id).toBe("session-1");
    expect(runtime.initSessionCalls).toBe(0);
    expect(runtime.hydratedSnapshots).toHaveLength(1);
    expect(runtime.loadContextCalls).toBe(2);
    expect(events.some((event) => event.type === "snapshot.restored")).toBe(true);
  });
});
