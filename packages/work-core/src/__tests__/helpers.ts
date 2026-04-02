import type { AgentRuntime, RuntimeResponse, SessionSnapshot } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import type { EventBus, WorkEvent } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { SnapshotSummary, StateStore } from "@octopus/state-store";
import {
  createWorkSession,
  type Action,
  type ActionResult,
  type WorkGoal,
  type WorkSession
} from "@octopus/work-contracts";
import type { ReleaseReason, WorkspaceLock } from "../workspace-lock.js";

export class FakeRuntime implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];
  initSessionCalls = 0;
  loadContextCalls = 0;
  pauseSessionCalls = 0;
  hydratedSnapshots: SessionSnapshot[] = [];

  constructor(
    private readonly responses: RuntimeResponse[],
    private readonly snapshotFactory: (sessionId: string) => SessionSnapshot = (sessionId) => ({
      schemaVersion: 2,
      snapshotId: `snapshot-${sessionId}`,
      capturedAt: new Date(),
      session: {
        id: sessionId,
        goalId: "goal-1",
        workspaceId: "default",
        configProfileId: "default",
        state: "blocked",
        items: [],
        observations: [],
        artifacts: [],
        transitions: [],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      runtimeContext: {
        pendingResults: []
      }
    })
  ) {}

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    this.initSessionCalls += 1;
    return createWorkSession(goal);
  }

  async pauseSession(): Promise<void> {
    this.pauseSessionCalls += 1;
  }

  async resumeSession(): Promise<void> {}

  async cancelSession(): Promise<void> {}

  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return this.snapshotFactory(sessionId);
  }

  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
    this.hydratedSnapshots.push(snapshot);
    return snapshot.session;
  }

  async getMetadata() {
    return {
      runtimeType: "embedded" as const
    };
  }

  async loadContext(): Promise<void> {
    this.loadContextCalls += 1;
  }

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

export class FakeSubstrate implements ExecutionSubstratePort {
  constructor(private readonly result: ActionResult) {}

  async execute(): Promise<ActionResult> {
    return this.result;
  }
}

export class MemoryStateStore implements StateStore {
  readonly sessions: WorkSession[] = [];
  readonly saveHistory: WorkSession[] = [];
  readonly snapshots = new Map<string, SessionSnapshot[]>();

  async saveSession(session: WorkSession): Promise<void> {
    const clone = structuredClone(session);
    this.saveHistory.push(clone);
    const index = this.sessions.findIndex((entry) => entry.id === session.id);
    if (index >= 0) {
      this.sessions[index] = clone;
      return;
    }
    this.sessions.push(clone);
  }

  async loadSession(sessionId: string): Promise<WorkSession | null> {
    return this.sessions.find((session) => session.id === sessionId) ?? null;
  }

  async listSessions() {
    return this.sessions.map((session) => ({
      id: session.id,
      goalId: session.goalId,
      workspaceId: session.workspaceId,
      configProfileId: session.configProfileId,
      ...(session.createdBy ? { createdBy: session.createdBy } : {}),
      ...(session.taskTitle ? { taskTitle: session.taskTitle } : {}),
      ...(session.namedGoalId ? { namedGoalId: session.namedGoalId } : {}),
      state: session.state,
      updatedAt: session.updatedAt
    }));
  }

  async saveSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    const snapshots = this.snapshots.get(sessionId) ?? [];
    snapshots.unshift(structuredClone(snapshot));
    this.snapshots.set(sessionId, snapshots);
  }

  async loadSnapshot(sessionId: string, snapshotId?: string): Promise<SessionSnapshot | null> {
    const snapshots = this.snapshots.get(sessionId) ?? [];
    if (!snapshotId) {
      return snapshots[0] ?? null;
    }
    return snapshots.find((snapshot) => snapshot.snapshotId === snapshotId) ?? null;
  }

  async listSnapshots(sessionId: string): Promise<SnapshotSummary[]> {
    return (this.snapshots.get(sessionId) ?? []).map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      schemaVersion: snapshot.schemaVersion
    }));
  }

  async saveArtifact(sessionId: string, artifact: WorkSession["artifacts"][number]): Promise<void> {
    const current = this.sessions.find((session) => session.id === sessionId);
    if (current) {
      current.artifacts.push(artifact);
    }
  }

  async loadArtifacts(sessionId: string) {
    return this.sessions.find((session) => session.id === sessionId)?.artifacts ?? [];
  }
}

export function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return {
    id: `action-${type}-${Math.random()}`,
    type,
    params,
    createdAt: new Date()
  };
}

export function allowAllPolicy(): SecurityPolicy {
  return {
    evaluate() {
      return {
        allowed: true,
        requiresConfirmation: false,
        riskLevel: "safe",
        reason: "Allowed in tests."
      };
    },
    approveForSession() {}
  };
}

export function blockingShellPolicy(): SecurityPolicy {
  return {
    evaluate() {
      return {
        allowed: true,
        requiresConfirmation: true,
        riskLevel: "consequential",
        reason: "Needs interactive approval."
      };
    },
    approveForSession() {}
  };
}

export function collectEvents(eventBus: EventBus): WorkEvent[] {
  const events: WorkEvent[] = [];
  eventBus.onAny((event) => {
    events.push(event);
  });
  return events;
}

export class RecordingWorkspaceLock implements WorkspaceLock {
  readonly acquired: Array<{ workspaceRoot: string; sessionId: string }> = [];
  readonly released: Array<{ workspaceRoot: string; sessionId: string; reason: ReleaseReason }> = [];

  async acquire(workspaceRoot: string, sessionId: string): Promise<void> {
    this.acquired.push({ workspaceRoot, sessionId });
  }

  async release(workspaceRoot: string, sessionId: string, reason: ReleaseReason): Promise<void> {
    this.released.push({ workspaceRoot, sessionId, reason });
  }

  async isHeld(): Promise<boolean> {
    return false;
  }

  async clearStale(): Promise<boolean> {
    return false;
  }
}
