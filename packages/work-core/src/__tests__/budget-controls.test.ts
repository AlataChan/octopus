import { describe, expect, it } from "vitest";

import type { AgentRuntime, ContextPayload, ResumeInput, RuntimeMetadata, RuntimeResponse, SessionSnapshot, TokenUsage } from "@octopus/agent-runtime";
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

describe("Budget Controls", () => {
  it("blocks session when token budget is exceeded", async () => {
    const runtime = new FakeRuntimeWithUsage([
      {
        kind: "action",
        action: createAction("read", { path: "a.txt" }),
        usage: { inputTokens: 60000, outputTokens: 60000 }
      },
      {
        kind: "action",
        action: createAction("read", { path: "b.txt" }),
        usage: { inputTokens: 60000, outputTokens: 60000 }
      }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(
      createWorkGoal({ description: "Test token budget" }),
      { budget: { maxTokens: 100000 } }
    );

    expect(session.state).toBe("blocked");
    expect(session.blockedReason).toMatchObject({
      kind: "budget-exceeded"
    });
  });

  it("accumulates usage across turns", async () => {
    const runtime = new FakeRuntimeWithUsage([
      {
        kind: "action",
        action: createAction("read", { path: "a.txt" }),
        usage: { inputTokens: 1000, outputTokens: 500 }
      },
      {
        kind: "action",
        action: createAction("read", { path: "b.txt" }),
        usage: { inputTokens: 1000, outputTokens: 500 }
      },
      {
        kind: "completion",
        evidence: "done",
        usage: { inputTokens: 1000, outputTokens: 200 }
      }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test usage tracking" }));

    expect(session.usage).toEqual(expect.objectContaining({
      totalInputTokens: 3000,
      totalOutputTokens: 1200,
      turnCount: 3
    }));
  });

  it("counts usage from blocked runtime responses", async () => {
    const runtime = new FakeRuntimeWithUsage([
      {
        kind: "blocked",
        reason: "Need operator input",
        usage: { inputTokens: 222, outputTokens: 33 }
      }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Track blocked usage" }));

    expect(session.state).toBe("blocked");
    expect(session.usage).toEqual(expect.objectContaining({
      totalInputTokens: 222,
      totalOutputTokens: 33,
      turnCount: 1
    }));
  });
});

class FakeRuntimeWithUsage implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];

  constructor(private readonly responses: Array<RuntimeResponse & { usage?: TokenUsage }>) {}

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
  async saveSession(_session: WorkSession): Promise<void> {}

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
  return {
    id: `action-${type}`,
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
