import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentRuntime, ContextPayload, RuntimeResponse, SessionSnapshot } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import { EventBus } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import { createWorkGoal, createWorkSession, type Action, type ActionResult, type WorkGoal, type WorkSession } from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";
import { RecordingWorkspaceLock } from "./helpers.js";

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
    expect(session.items[0]?.description).toBe(goal.description);
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

  it("preserves riskLevel when policy denies an action", async () => {
    const goal = createWorkGoal({ description: "Run rm" });
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "rm", args: ["-rf", "/tmp/test"] })
      }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      {
        evaluate() {
          return {
            allowed: false,
            requiresConfirmation: false,
            riskLevel: "dangerous",
            reason: "Denied by policy."
          };
        },
        approveForSession() {}
      }
    );

    const session = await engine.executeGoal(goal);

    expect(session.state).toBe("blocked");
    expect(session.blockedReason).toEqual({
      kind: "system-error",
      evidence: "Denied by policy.",
      riskLevel: "dangerous"
    });
  });

  it("releases the workspace lock when policy blocks an action", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-work-core-"));
    tempDirs.push(workspaceRoot);
    const goal = createWorkGoal({ description: "Run git status" });
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "git", args: ["status"] })
      }
    ]);
    const lock = new RecordingWorkspaceLock();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      blockingShellPolicy(),
      { workspaceLock: lock }
    );

    const session = await engine.executeGoal(goal, { workspaceRoot });

    expect(session.state).toBe("blocked");
    expect(lock.acquired).toHaveLength(1);
    expect(lock.released).toEqual([
      {
        workspaceRoot,
        sessionId: session.id,
        reason: "cancelled"
      }
    ]);
  });

  it("releases the workspace lock when the runtime blocks the session", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-work-core-"));
    tempDirs.push(workspaceRoot);
    const goal = createWorkGoal({ description: "Need clarification" });
    const runtime = new FakeRuntime([{ kind: "blocked", reason: "Need clarification" }]);
    const lock = new RecordingWorkspaceLock();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy(),
      { workspaceLock: lock }
    );

    const session = await engine.executeGoal(goal, { workspaceRoot });

    expect(session.state).toBe("blocked");
    expect(session.blockedReason).toEqual({
      kind: "system-error",
      evidence: "Need clarification"
    });
    expect(lock.acquired).toHaveLength(1);
    expect(lock.released).toEqual([
      {
        workspaceRoot,
        sessionId: session.id,
        reason: "cancelled"
      }
    ]);
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
    expect(session.blockedReason).toEqual({
      kind: "verification-failed",
      evidence: "Completion predicate failed."
    });
    expect(session.transitions.map((transition) => transition.to)).not.toContain("completed");
    expect(session.transitions.at(-1)?.reason).toBe("Completion predicate failed.");
  });

  it("derives a goalSummary for fresh sessions and persists it", async () => {
    const description = "  读取   README.md   并整理成一个适合产品经理快速浏览的中文摘要，保留关键限制与输出要求。  ";
    const runtime = new FakeRuntime([{ kind: "completion", evidence: "done" }]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description }));

    expect(session.goalSummary).toBeDefined();
    expect(session.goalSummary).toContain("读取 README.md 并整理成一个适合产品经理快速浏览的中文摘要");
    expect(session.goalSummary).not.toContain("  ");
    expect(session.goalSummary?.length).toBeLessThan(description.length);
    expect(session.goalSummary?.length).toBeLessThanOrEqual(60);
    expect(store.sessions.at(-1)?.goalSummary).toBe(session.goalSummary);
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

  it("loads recursive visible files while excluding dotfiles", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-work-core-"));
    tempDirs.push(workspaceRoot);
    await writeFile(join(workspaceRoot, "README.md"), "root", "utf8");
    await mkdir(join(workspaceRoot, "nested", "deeper"), { recursive: true });
    await writeFile(join(workspaceRoot, "nested", "deeper", "report.txt"), "report", "utf8");
    await writeFile(join(workspaceRoot, ".env"), "secret", "utf8");
    await mkdir(join(workspaceRoot, ".git"), { recursive: true });
    await writeFile(join(workspaceRoot, ".git", "config"), "[core]", "utf8");

    const runtime = new FakeRuntime([{ kind: "completion", evidence: "done" }]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    await engine.executeGoal(createWorkGoal({ description: "Index visible files" }), { workspaceRoot });

    expect(runtime.lastContextPayload?.visibleFiles).toEqual(
      expect.arrayContaining(["README.md", "nested/deeper/report.txt", "PLAN.md", "TODO.md", "STATUS.md"])
    );
    expect(runtime.lastContextPayload?.visibleFiles).not.toEqual(expect.arrayContaining([".env", ".git/config"]));
  });

  it("includes configured MCP tools in the initial runtime context", async () => {
    const runtime = new FakeRuntime([{ kind: "completion", evidence: "done" }]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy(),
      {
        mcpTools: [
          {
            serverId: "filesystem",
            name: "read_file",
            description: "Read file",
            inputSchema: { type: "object" }
          }
        ]
      }
    );

    await engine.executeGoal(createWorkGoal({ description: "Use MCP tools" }));

    expect(runtime.lastContextPayload?.mcpTools).toEqual([
      {
        serverId: "filesystem",
        name: "read_file",
        description: "Read file",
        inputSchema: { type: "object" }
      }
    ]);
  });

  it("refreshes restored runtime context with the current MCP tools", async () => {
    const goal = createWorkGoal({ description: "Resume with refreshed MCP tools" });
    const runtime = new FakeRuntime([{ kind: "completion", evidence: "done" }]);
    const snapshotStore = new SnapshotStore({
      schemaVersion: 2,
      snapshotId: "snapshot-1",
      capturedAt: new Date(),
      session: createWorkSession(goal, { id: "session-restore-1" }),
      runtimeContext: {
        pendingResults: [],
        contextPayload: {
          workspaceSummary: "repo root",
          mcpTools: [
            {
              serverId: "stale",
              name: "old_tool",
              description: "Old tool",
              inputSchema: { type: "object" }
            }
          ]
        }
      }
    });
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      snapshotStore,
      new EventBus(),
      allowAllPolicy(),
      {
        mcpTools: [
          {
            serverId: "filesystem",
            name: "read_file",
            description: "Read file",
            inputSchema: { type: "object" }
          }
        ]
      }
    );

    await engine.executeGoal(goal, {
      resumeFrom: { sessionId: "session-restore-1" }
    });

    expect(runtime.lastContextPayload?.mcpTools).toEqual([
      {
        serverId: "filesystem",
        name: "read_file",
        description: "Read file",
        inputSchema: { type: "object" }
      }
    ]);
  });

  it("treats mcp-call as a network action for policy evaluation", async () => {
    const categories: string[] = [];
    const policy: SecurityPolicy = {
      evaluate(_action, category) {
        categories.push(category);
        return {
          allowed: true,
          requiresConfirmation: true,
          riskLevel: "consequential",
          reason: "Needs confirmation."
        };
      },
      approveForSession() {}
    };
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("mcp-call", {
          serverId: "filesystem",
          toolName: "read_file",
          arguments: { path: "README.md" }
        })
      }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      policy
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Check category mapping" }));

    expect(session.state).toBe("blocked");
    expect(categories).toEqual(["network"]);
  });
});

class FakeRuntime implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];
  lastContextPayload?: ContextPayload;

  constructor(private readonly responses: RuntimeResponse[]) {}

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    return createWorkSession(goal);
  }

  async pauseSession(): Promise<void> {}

  async resumeSession(): Promise<void> {}

  async cancelSession(): Promise<void> {}

  async snapshotSession(sessionId: string) {
    return this.buildSnapshot(sessionId);
  }

  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
    return snapshot.session;
  }

  async getMetadata() {
    return {
      runtimeType: "embedded" as const
    };
  }

  async loadContext(_sessionId: string, context: ContextPayload): Promise<void> {
    this.lastContextPayload = context;
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

  private buildSnapshot(sessionId: string): SessionSnapshot {
    return {
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
    };
  }
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
      workspaceId: session.workspaceId,
      configProfileId: session.configProfileId,
      ...(session.createdBy ? { createdBy: session.createdBy } : {}),
      ...(session.taskTitle ? { taskTitle: session.taskTitle } : {}),
      ...(session.namedGoalId ? { namedGoalId: session.namedGoalId } : {}),
      ...(session.goalSummary ? { goalSummary: session.goalSummary } : {}),
      state: session.state,
      updatedAt: session.updatedAt
    }));
  }

  async saveSnapshot(): Promise<void> {}

  async loadSnapshot(): Promise<SessionSnapshot | null> {
    return null;
  }

  async listSnapshots() {
    return [];
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

class SnapshotStore extends MemoryStateStore {
  constructor(private readonly snapshot: SessionSnapshot) {
    super();
  }

  override async loadSnapshot(): Promise<SessionSnapshot> {
    return this.snapshot;
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
