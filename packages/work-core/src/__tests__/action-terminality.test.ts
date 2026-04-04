import { describe, expect, it } from "vitest";

import type { AgentRuntime, ContextPayload, ResumeInput, RuntimeMetadata, RuntimeResponse, SessionSnapshot } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import { EventBus } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { SnapshotSummary, StateStore } from "@octopus/state-store";
import {
  createWorkGoal,
  createWorkSession,
  type Action,
  type ActionResult,
  type Artifact,
  type SessionSummary,
  type WorkGoal,
  type WorkSession
} from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";

describe("Action Result Terminality", () => {
  it("produces a failed outcome when substrate throws", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "boom", args: [] })
      },
      { kind: "completion", evidence: "done" }
    ]);
    const crashingSubstrate: ExecutionSubstratePort = {
      async execute() {
        throw new Error("Substrate exploded");
      }
    };
    const engine = new WorkEngine(
      runtime,
      crashingSubstrate,
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test crash" }));

    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("failed");
    expect(runtime.ingestedResults[0]?.success).toBe(false);
    expect(runtime.ingestedResults[0]?.error).toContain("Substrate exploded");
    expect(session.state).toBe("completed");
  });

  it("produces a denied outcome and ingests result when policy denies", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "rm", args: ["-rf", "/"] })
      }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      denyAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test deny" }));

    expect(session.state).toBe("blocked");
    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("denied");
    expect(runtime.ingestedResults[0]?.error).toContain("Security policy denied");
  });

  it("produces timed_out outcome when substrate reports timeout", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "sleep", args: ["999"] })
      },
      { kind: "completion", evidence: "done" }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: false, output: "", error: "Timed out", timedOut: true }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    await engine.executeGoal(createWorkGoal({ description: "Test timeout" }));

    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("timed_out");
  });

  it("treats non-timeout command failures as completed executions", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "false", args: [] })
      },
      { kind: "completion", evidence: "done" }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: false, output: "", error: "exit 1", timedOut: false }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    await engine.executeGoal(createWorkGoal({ description: "Test non-timeout failure" }));

    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]).toMatchObject({
      success: false,
      error: "exit 1",
      outcome: "completed"
    });
  });

  it("synthesizes interrupted outcomes for orphaned actions during resume", async () => {
    const goal = createWorkGoal({ description: "Resume interrupted action" });
    const blockedSession = createWorkSession(goal);
    blockedSession.state = "blocked";
    blockedSession.blockedReason = {
      kind: "paused-by-operator",
      evidence: "paused"
    };
    blockedSession.items.push({
      id: "item-1",
      sessionId: blockedSession.id,
      description: goal.description,
      state: "active",
      observations: [],
      actions: [createAction("read", { path: "README.md" })],
      verifications: [],
      createdAt: new Date()
    });

    const runtime = new FakeRuntime([{ kind: "completion", evidence: "resumed" }]);
    const store = new MemoryStateStore({
      session: blockedSession,
      snapshot: {
        schemaVersion: 2,
        snapshotId: "snap-1",
        capturedAt: new Date(),
        session: structuredClone(blockedSession),
        runtimeContext: { pendingResults: [] }
      }
    });
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );

    const resumed = await engine.resumeBlockedSession(blockedSession.id, { kind: "operator" });

    expect(resumed.state).toBe("completed");
    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]).toMatchObject({
      success: false,
      outcome: "interrupted",
      error: "Action was interrupted by process termination"
    });
  });
});

class FakeRuntime implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];

  constructor(private readonly responses: RuntimeResponse[]) {}

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    return createWorkSession(goal);
  }

  async pauseSession(): Promise<void> {}

  async resumeSession(_sessionId: string, _input?: ResumeInput): Promise<void> {}

  async cancelSession(): Promise<void> {}

  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return {
      schemaVersion: 2,
      snapshotId: `snap-${sessionId}`,
      capturedAt: new Date(),
      session: createWorkSession(createWorkGoal({ description: "snap" })),
      runtimeContext: { pendingResults: [] }
    };
  }

  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
    return snapshot.session;
  }

  async getMetadata(): Promise<RuntimeMetadata> {
    return { runtimeType: "embedded" };
  }

  async loadContext(_sessionId: string, _context: ContextPayload): Promise<void> {}

  async requestNextAction(): Promise<RuntimeResponse> {
    const response = this.responses.shift();
    if (!response) {
      throw new Error("No more fake responses.");
    }
    return response;
  }

  async ingestToolResult(_sessionId: string, _actionId: string, result: ActionResult): Promise<void> {
    this.ingestedResults.push(result);
  }

  signalCompletion(): void {}

  signalBlocked(): void {}
}

class FakeSubstrate implements ExecutionSubstratePort {
  constructor(private readonly result: ActionResult) {}

  async execute(): Promise<ActionResult> {
    return this.result;
  }
}

class MemoryStateStore implements StateStore {
  readonly sessions: WorkSession[] = [];
  readonly saveHistory: WorkSession[] = [];
  private readonly sessionMap = new Map<string, WorkSession>();
  private readonly snapshotMap = new Map<string, SessionSnapshot>();

  constructor(seed?: { session?: WorkSession; snapshot?: SessionSnapshot }) {
    if (seed?.session) {
      this.sessionMap.set(seed.session.id, structuredClone(seed.session));
    }
    if (seed?.snapshot) {
      this.snapshotMap.set(seed.snapshot.session.id, structuredClone(seed.snapshot));
    }
  }

  async saveSession(session: WorkSession): Promise<void> {
    const clone = structuredClone(session);
    this.saveHistory.push(clone);
    this.sessionMap.set(clone.id, clone);
    const index = this.sessions.findIndex((entry) => entry.id === clone.id);
    if (index >= 0) {
      this.sessions[index] = clone;
      return;
    }
    this.sessions.push(clone);
  }

  async loadSession(sessionId: string): Promise<WorkSession | null> {
    return this.sessionMap.get(sessionId) ?? null;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return [];
  }

  async saveSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    this.snapshotMap.set(sessionId, structuredClone(snapshot));
  }

  async loadSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    return this.snapshotMap.get(sessionId) ?? null;
  }

  async listSnapshots(): Promise<SnapshotSummary[]> {
    return [];
  }

  async saveArtifact(_sessionId: string, _artifact: Artifact): Promise<void> {}

  async loadArtifacts(): Promise<Artifact[]> {
    return [];
  }
}

function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return {
    id: `action-${type}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    params,
    createdAt: new Date()
  };
}

function allowAllPolicy(): SecurityPolicy {
  return {
    evaluate: () => ({ allowed: true, requiresConfirmation: false, riskLevel: "safe", reason: "Allowed." }),
    approveForSession() {}
  };
}

function denyAllPolicy(): SecurityPolicy {
  return {
    evaluate: () => ({ allowed: false, requiresConfirmation: false, riskLevel: "dangerous", reason: "Denied by policy." }),
    approveForSession() {}
  };
}
