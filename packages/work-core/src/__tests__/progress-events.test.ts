import { describe, expect, it } from "vitest";

import type { AgentRuntime, ContextPayload, ResumeInput, RuntimeMetadata, RuntimeResponse, SessionSnapshot } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort, SubstrateContext } from "@octopus/exec-substrate";
import { EventBus, type WorkEvent } from "@octopus/observability";
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

describe("Progress Events", () => {
  it("emits action.progress events during action execution", async () => {
    const eventBus = new EventBus();
    const progressEvents: Array<Extract<WorkEvent, { type: "action.progress" }>> = [];
    eventBus.on("action.progress", (event) => {
      progressEvents.push(event);
    });

    const runtime = new FakeRuntime([
      { kind: "action", action: createAction("shell", { executable: "echo", args: ["hello"] }) },
      { kind: "completion", evidence: "done" }
    ]);
    const engine = new WorkEngine(
      runtime,
      new ProgressSubstrate(["hello ", "world"]),
      new MemoryStateStore(),
      eventBus,
      allowAllPolicy()
    );

    await engine.executeGoal(createWorkGoal({ description: "Emit progress" }));

    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[0]?.payload).toMatchObject({
      actionType: "shell",
      stream: "stdout"
    });
  });

  it("coalesces noisy shell output into bounded progress events", async () => {
    const eventBus = new EventBus();
    const progressEvents: Array<Extract<WorkEvent, { type: "action.progress" }>> = [];
    eventBus.on("action.progress", (event) => {
      progressEvents.push(event);
    });

    const runtime = new FakeRuntime([
      { kind: "action", action: createAction("shell", { executable: "echo", args: ["loud"] }) },
      { kind: "completion", evidence: "done" }
    ]);
    const noisyChunks = Array.from({ length: 100 }, () => "x".repeat(100));
    const engine = new WorkEngine(
      runtime,
      new ProgressSubstrate(noisyChunks),
      new MemoryStateStore(),
      eventBus,
      allowAllPolicy()
    );

    await engine.executeGoal(createWorkGoal({ description: "Coalesce noisy output" }));

    expect(progressEvents.length).toBeLessThanOrEqual(3);
    expect(progressEvents.every((event) => event.payload.chunk.length <= 4096)).toBe(true);
  });
});

class ProgressSubstrate implements ExecutionSubstratePort {
  constructor(private readonly chunks: string[]) {}

  async execute(_action: Action, context: SubstrateContext): Promise<ActionResult> {
    for (const chunk of this.chunks) {
      context.onProgress?.("stdout", chunk);
    }

    return {
      success: true,
      output: this.chunks.join("")
    };
  }
}

class FakeRuntime implements AgentRuntime {
  readonly type = "embedded" as const;

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

  async ingestToolResult(): Promise<void> {}

  signalCompletion(): void {}

  signalBlocked(): void {}
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
