import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentRuntime, RuntimeResponse } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import { EventBus } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import { createWorkGoal, createWorkSession, type Action, type ActionResult, type WorkGoal, type WorkSession } from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WorkEngine", () => {
  it("runs the core loop to completion and writes visible state", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-work-core-"));
    tempDirs.push(workspaceRoot);

    const goal = createWorkGoal({ description: "List files" });
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("read", { path: "README.md", encoding: "utf8" })
      },
      {
        kind: "completion",
        evidence: "Verified output persisted"
      }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "README contents" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(goal, { workspaceRoot });

    expect(session.state).toBe("completed");
    expect(runtime.ingestedResults).toHaveLength(1);
    expect(store.sessions).toHaveLength(1);
    expect(await readFile(join(workspaceRoot, "STATUS.md"), "utf8")).toContain("Known limitations: none");
    expect(await readFile(join(workspaceRoot, "PLAN.md"), "utf8")).toContain(goal.description);
    expect(await readFile(join(workspaceRoot, "TODO.md"), "utf8")).toContain("Goal complete");
  });

  it("blocks when policy requires confirmation", async () => {
    const goal = createWorkGoal({ description: "Run git status" });
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "git", args: ["status"] })
      }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      blockingShellPolicy()
    );

    const session = await engine.executeGoal(goal);

    expect(session.state).toBe("blocked");
    expect(runtime.ingestedResults).toHaveLength(0);
    expect(store.sessions.at(-1)?.state).toBe("blocked");
  });

  it("does not record a completed transition when completion evidence is incomplete", async () => {
    const goal = createWorkGoal({ description: "Read docs without workspace state" });
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("read", { path: "README.md", encoding: "utf8" })
      },
      {
        kind: "completion",
        evidence: "Looks done"
      }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "README contents" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(goal);

    expect(session.state).toBe("blocked");
    expect(session.transitions.map((transition) => transition.to)).not.toContain("completed");
    expect(session.transitions.at(-1)?.reason).toBe("Completion predicate failed.");
  });

  it("keeps the active work item open until the session actually completes", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-work-core-"));
    tempDirs.push(workspaceRoot);

    const goal = createWorkGoal({ description: "Inspect files and verify state" });
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("read", { path: "README.md", encoding: "utf8" })
      },
      {
        kind: "action",
        action: createAction("search", { query: "octopus" })
      },
      {
        kind: "completion",
        evidence: "Verified completion"
      }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(goal, { workspaceRoot });

    expect(session.items[0]?.state).toBe("done");
    expect(
      store.saveHistory
        .slice(0, -1)
        .every((snapshot) => snapshot.items[0]?.state !== "done")
    ).toBe(true);
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

  async resumeSession(): Promise<void> {}

  async cancelSession(): Promise<void> {}

  async snapshotSession(sessionId: string) {
    return {
      sessionId,
      capturedAt: new Date()
    };
  }

  async getMetadata() {
    return {
      runtimeType: "embedded" as const
    };
  }

  async loadContext(): Promise<void> {}

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

  async loadSession(): Promise<WorkSession | null> {
    return null;
  }

  async listSessions() {
    return this.sessions.map((session) => ({
      id: session.id,
      goalId: session.goalId,
      state: session.state,
      updatedAt: session.updatedAt
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

function blockingShellPolicy(): SecurityPolicy {
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
