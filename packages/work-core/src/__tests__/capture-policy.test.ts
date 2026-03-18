import { describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import { createWorkGoal } from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";
import { allowAllPolicy, collectEvents, FakeRuntime, FakeSubstrate, MemoryStateStore } from "./helpers.js";

describe("WorkEngine snapshot capture policy", () => {
  it("captures a snapshot when the session becomes blocked", async () => {
    const eventBus = new EventBus();
    const events = collectEvents(eventBus);
    const store = new MemoryStateStore();
    const runtime = new FakeRuntime([{ kind: "blocked", reason: "Need clarification" }]);
    const engine = new WorkEngine(runtime, new FakeSubstrate({ success: true, output: "ok" }), store, eventBus, allowAllPolicy());

    const session = await engine.executeGoal(createWorkGoal({ description: "Block and snapshot" }));

    expect(session.state).toBe("blocked");
    await expect(store.listSnapshots(session.id)).resolves.toHaveLength(1);
    expect(events.some((event) => event.type === "snapshot.captured")).toBe(true);
  });

  it("does not capture a snapshot when the session completes normally", async () => {
    const eventBus = new EventBus();
    const store = new MemoryStateStore();
    const runtime = new FakeRuntime([{ kind: "completion", evidence: "done" }]);
    const engine = new WorkEngine(runtime, new FakeSubstrate({ success: true, output: "ok" }), store, eventBus, allowAllPolicy());

    const session = await engine.executeGoal(createWorkGoal({ description: "Complete cleanly" }));

    await expect(store.listSnapshots(session.id)).resolves.toHaveLength(0);
  });

  it("captures a snapshot when pauseSession is invoked", async () => {
    const eventBus = new EventBus();
    const events = collectEvents(eventBus);
    const store = new MemoryStateStore();
    const goal = createWorkGoal({ description: "Pause work" });
    const session = {
      id: "session-pause",
      goalId: goal.id,
      state: "active" as const,
      items: [],
      observations: [],
      artifacts: [],
      transitions: [],
      createdAt: new Date("2026-03-18T00:00:00.000Z"),
      updatedAt: new Date("2026-03-18T00:00:00.000Z")
    };
    await store.saveSession(session);

    const runtime = new FakeRuntime([]);
    const engine = new WorkEngine(runtime, new FakeSubstrate({ success: true, output: "ok" }), store, eventBus, allowAllPolicy());

    await engine.pauseSession(session.id);

    expect(runtime.pauseSessionCalls).toBe(1);
    await expect(store.listSnapshots(session.id)).resolves.toHaveLength(1);
    expect(events.some((event) => event.type === "snapshot.captured")).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["session.blocked", "snapshot.captured"]);
  });
});
