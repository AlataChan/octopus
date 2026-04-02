import { describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import type { SessionSummary, WorkGoal, WorkSession } from "@octopus/work-contracts";

import { AutomationDispatcher } from "../dispatcher.js";
import type { AutomationEvent, NamedGoalRegistry } from "../types.js";

describe("AutomationDispatcher", () => {
  it("skips the trigger when a matching session is already active", async () => {
    const events = collectEvents();
    const engine = createEngineDouble();
    const stateStore = createStateStore([
      createSessionSummary({
        id: "session-1",
        goalId: "goal-1",
        namedGoalId: "daily-report",
        state: "active",
        updatedAt: new Date("2026-03-18T00:00:00.000Z")
      })
    ]);
    const dispatcher = new AutomationDispatcher(stateStore, engine, createRegistry(), events.bus);

    await dispatcher.dispatch(createEvent("daily-report", "cron"));

    expect(engine.calls).toHaveLength(0);
    expect(events.types).toEqual(["event.injected", "automation.triggered"]);
    expect(events.injectedActions).toEqual(["skipped"]);
  });

  it("resumes a blocked session for the same named goal", async () => {
    const events = collectEvents();
    const engine = createEngineDouble();
    const stateStore = createStateStore([
      createSessionSummary({
        id: "session-2",
        goalId: "goal-2",
        namedGoalId: "daily-report",
        state: "blocked",
        updatedAt: new Date("2026-03-18T00:00:00.000Z")
      })
    ]);
    const dispatcher = new AutomationDispatcher(stateStore, engine, createRegistry(), events.bus, {
      workspaceRoot: "/workspace"
    });

    await dispatcher.dispatch(createEvent("daily-report", "cron"));

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.goal.namedGoalId).toBe("daily-report");
    expect(engine.calls[0]?.options).toEqual({
      workspaceRoot: "/workspace",
      resumeFrom: { sessionId: "session-2" }
    });
    expect(events.injectedActions).toEqual(["resumed"]);
  });

  it("resumes a verifying session for the same named goal", async () => {
    const events = collectEvents();
    const engine = createEngineDouble();
    const stateStore = createStateStore([
      createSessionSummary({
        id: "session-verify",
        goalId: "goal-verify",
        namedGoalId: "daily-report",
        state: "verifying",
        updatedAt: new Date("2026-03-18T00:00:00.000Z")
      })
    ]);
    const dispatcher = new AutomationDispatcher(stateStore, engine, createRegistry(), events.bus, {
      workspaceRoot: "/workspace"
    });

    await dispatcher.dispatch(createEvent("daily-report", "watcher"));

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.options).toEqual({
      workspaceRoot: "/workspace",
      resumeFrom: { sessionId: "session-verify" }
    });
    expect(events.injectedActions).toEqual(["resumed"]);
  });

  it("creates a new session when no matching session exists", async () => {
    const events = collectEvents();
    const engine = createEngineDouble();
    const dispatcher = new AutomationDispatcher(createStateStore([]), engine, createRegistry(), events.bus, {
      workspaceRoot: "/workspace"
    });

    await dispatcher.dispatch(createEvent("daily-report", "watcher"));

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.options).toEqual({ workspaceRoot: "/workspace" });
    expect(events.injectedActions).toEqual(["created"]);
  });

  it("emits failure and skips when the named goal is missing at runtime", async () => {
    const events = collectEvents();
    const engine = createEngineDouble();
    const dispatcher = new AutomationDispatcher(createStateStore([]), engine, {}, events.bus);

    await dispatcher.dispatch(createEvent("unknown-goal", "cron"));

    expect(engine.calls).toHaveLength(0);
    expect(events.types).toEqual(["automation.source.failed"]);
  });
});

function createRegistry(): NamedGoalRegistry {
  return {
    "daily-report": {
      description: "Generate daily report",
      constraints: ["Write to reports/"],
      successCriteria: ["Report exists"]
    }
  };
}

function createEvent(namedGoalId: string, sourceType: AutomationEvent["sourceType"]): AutomationEvent {
  return {
    sourceType,
    namedGoalId,
    triggeredAt: new Date("2026-03-18T00:00:00.000Z")
  };
}

function createSessionSummary(
  input: Pick<SessionSummary, "id" | "goalId" | "state" | "updatedAt"> & Partial<SessionSummary>
): SessionSummary {
  return {
    workspaceId: "default",
    configProfileId: "default",
    ...input
  };
}

function createStateStore(sessions: SessionSummary[]) {
  return {
    async saveSession() {
      throw new Error("not implemented");
    },
    async loadSession() {
      return null;
    },
    async listSessions() {
      return sessions;
    },
    async saveSnapshot() {
      throw new Error("not implemented");
    },
    async loadSnapshot() {
      return null;
    },
    async listSnapshots() {
      return [];
    },
    async saveArtifact() {
      throw new Error("not implemented");
    },
    async loadArtifacts() {
      return [];
    }
  };
}

function createEngineDouble() {
  const calls: Array<{ goal: WorkGoal; options?: Record<string, unknown> }> = [];

  return {
    calls,
    async executeGoal(goal: WorkGoal, options?: Record<string, unknown>): Promise<WorkSession> {
      calls.push({ goal, options });
      return {
        id: "session-created",
        goalId: goal.id,
        workspaceId: "default",
        configProfileId: "default",
        namedGoalId: goal.namedGoalId,
        state: "active",
        items: [],
        observations: [],
        artifacts: [],
        transitions: [],
        createdAt: new Date("2026-03-18T00:00:00.000Z"),
        updatedAt: new Date("2026-03-18T00:00:00.000Z")
      };
    }
  };
}

function collectEvents() {
  const bus = new EventBus();
  const types: string[] = [];
  const injectedActions: string[] = [];

  bus.onAny((event) => {
    types.push(event.type);
    if (event.type === "event.injected") {
      injectedActions.push(event.payload.action);
    }
  });

  return { bus, types, injectedActions };
}
