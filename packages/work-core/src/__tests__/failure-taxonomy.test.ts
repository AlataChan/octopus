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

describe("Failure Taxonomy", () => {
  it("blocks session when runtime returns blocked after retryable errors", async () => {
    const runtime = new FakeRuntime([
      { kind: "blocked", reason: "[retry-exhausted] Model request failed after retries." }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test retry exhaustion" }));

    expect(session.state).toBe("blocked");
    expect(session.blockedReason).toMatchObject({
      kind: "system-error",
      evidence: "[retry-exhausted] Model request failed after retries."
    });
  });

  it("blocks session when runtime returns blocked for non-retryable errors", async () => {
    const runtime = new FakeRuntime([
      { kind: "blocked", reason: "Model API call failed with status 401: Invalid API key" }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test non-retryable" }));

    expect(session.state).toBe("blocked");
    expect(session.blockedReason?.kind).toBe("system-error");
  });

  it("continues loop after action crash with synthetic failed result", async () => {
    const runtime = new FakeRuntime([
      { kind: "action", action: createAction("shell", { executable: "crash", args: [] }) },
      { kind: "completion", evidence: "recovered" }
    ]);
    const crashingSubstrate: ExecutionSubstratePort = {
      async execute() {
        throw new Error("Process crashed");
      }
    };
    const engine = new WorkEngine(
      runtime,
      crashingSubstrate,
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test crash recovery" }));

    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("failed");
    expect(session.state).toBe("completed");
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

  async saveSession(session: WorkSession): Promise<void> {
    const clone = structuredClone(session);
    const index = this.sessions.findIndex((entry) => entry.id === clone.id);
    if (index >= 0) {
      this.sessions[index] = clone;
      return;
    }
    this.sessions.push(clone);
  }

  async loadSession(): Promise<WorkSession | null> {
    return null;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return [];
  }

  async saveSnapshot(): Promise<void> {}

  async loadSnapshot(): Promise<SessionSnapshot | null> {
    return null;
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
  return { id: `action-${type}`, type, params, createdAt: new Date() };
}

function allowAllPolicy(): SecurityPolicy {
  return {
    evaluate: () => ({ allowed: true, requiresConfirmation: false, riskLevel: "safe", reason: "Allowed." }),
    approveForSession() {}
  };
}
