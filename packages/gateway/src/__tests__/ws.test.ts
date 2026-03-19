import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRuntime, SessionSnapshot } from "@octopus/agent-runtime";
import { EventBus, type WorkEvent } from "@octopus/observability";
import type { PolicyResolution, SecurityPolicy } from "@octopus/security";
import type { SnapshotSummary, StateStore } from "@octopus/state-store";
import {
  createWorkGoal,
  createWorkSession,
  type Artifact,
  type SessionSummary,
  type WorkGoal,
  type WorkSession
} from "@octopus/work-contracts";
import type { WorkEngine } from "@octopus/work-core";

import { TokenStore } from "../auth.js";
import type { RouteDeps } from "../routes/shared.js";
import type { GatewayConfig } from "../types.js";
import { handleEventStreamUpgrade } from "../ws/event-stream.js";
import { handleRuntimeProtocolUpgrade } from "../ws/runtime-protocol.js";

describe("gateway websocket handlers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("closes event-stream connections that do not authenticate before the timeout", () => {
    vi.useFakeTimers();
    const { deps } = createDeps({
      wsAuthTimeoutMs: 50
    });
    const ws = new FakeWebSocket();

    handleEventStreamUpgrade({} as never, ws as never, "session-1", deps);
    vi.advanceTimersByTime(51);

    expect(ws.sentMessages).toEqual([{ type: "auth.timeout" }]);
    expect(ws.closed).toBe(true);
  });

  it("authenticates event-stream connections and sends backfill plus live events", async () => {
    const sessionId = "session-1";
    const backfill = [
      createEvent("event-backfill", sessionId, "session.started", {
        goalDescription: "Backfill"
      })
    ];
    const { deps, eventBus } = createDeps(
      {},
      {
        traceEvents: backfill
      }
    );
    const ws = new FakeWebSocket();

    handleEventStreamUpgrade({} as never, ws as never, sessionId, deps);
    ws.receive({
      type: "auth",
      apiKey: "secret"
    });
    await flushAsync();

    expect(ws.sentMessages[0]).toEqual({ type: "auth.ok" });
    expect(ws.sentMessages[1]).toEqual({
      type: "backfill",
      events: backfill.map((event) => ({
        ...event,
        timestamp: event.timestamp.toISOString()
      }))
    });

    const matchingEvent = createEvent("event-live", sessionId, "session.completed", {
      evidence: "done"
    });
    const otherEvent = createEvent("event-other", "session-2", "session.completed", {
      evidence: "ignored"
    });

    eventBus.emit(matchingEvent);
    eventBus.emit(otherEvent);
    await flushAsync();

    expect(ws.sentMessages).toContainEqual({
      ...matchingEvent,
      timestamp: matchingEvent.timestamp.toISOString()
    });
    expect(ws.sentMessages).not.toContainEqual(otherEvent);
  });

  it("dispatches pause control messages through the event-stream channel", async () => {
    const { deps, pauseSession } = createDeps();
    const ws = new FakeWebSocket();

    handleEventStreamUpgrade({} as never, ws as never, "session-1", deps);
    ws.receive({
      type: "auth",
      apiKey: "secret"
    });
    await flushAsync();

    ws.receive({
      type: "control",
      action: "pause"
    });
    await flushAsync();

    expect(pauseSession).toHaveBeenCalledWith("session-1");
  });

  it("rejects cancel control messages over the event-stream channel", async () => {
    const { deps, cancelSession } = createDeps();
    const ws = new FakeWebSocket();

    handleEventStreamUpgrade({} as never, ws as never, "session-1", deps);
    ws.receive({
      type: "auth",
      apiKey: "secret"
    });
    await flushAsync();

    ws.receive({
      type: "control",
      action: "cancel"
    });
    await flushAsync();

    expect(cancelSession).not.toHaveBeenCalled();
    expect(ws.sentMessages).toContainEqual({
      type: "error",
      error: "Cancel is not available over the event stream."
    });
  });

  it("rejects runtime protocol connections when runtime proxy is disabled", () => {
    const { deps } = createDeps({
      auth: {
        apiKey: "secret",
        defaultPermissions: ["sessions.read"],
        enableRuntimeProxy: false
      }
    });
    const ws = new FakeWebSocket();

    handleRuntimeProtocolUpgrade({} as never, ws as never, deps);

    expect(ws.sentMessages).toEqual([
      {
        type: "error",
        reason: "Runtime proxy not enabled"
      }
    ]);
    expect(ws.closed).toBe(true);
  });

  it("requires runtime.proxy permission for runtime protocol access", async () => {
    const { deps } = createDeps({
      auth: {
        apiKey: "secret",
        defaultPermissions: ["sessions.read"],
        enableRuntimeProxy: true
      }
    });
    const ws = new FakeWebSocket();

    handleRuntimeProtocolUpgrade({} as never, ws as never, deps);
    ws.receive({
      type: "auth",
      apiKey: "secret"
    });
    await flushAsync();

    expect(ws.sentMessages[0]).toEqual({
      type: "auth.failed",
      reason: "Missing permission: runtime.proxy"
    });
    expect(ws.closed).toBe(true);
  });

  it("dispatches runtime protocol requests and preserves requestId correlation", async () => {
    const { deps } = createDeps({
      auth: {
        apiKey: "secret",
        defaultPermissions: ["sessions.read", "runtime.proxy"],
        enableRuntimeProxy: true
      }
    });
    const ws = new FakeWebSocket();

    handleRuntimeProtocolUpgrade({} as never, ws as never, deps);
    ws.receive({
      type: "auth",
      apiKey: "secret"
    });
    await flushAsync();

    ws.receive({
      type: "runtime.getMetadata",
      requestId: "req-1",
      sessionId: "session-1"
    });
    await flushAsync();

    expect(ws.sentMessages[0]).toEqual({ type: "auth.ok" });
    expect(ws.sentMessages[1]).toEqual({
      type: "runtime.getMetadata.result",
      requestId: "req-1",
      metadata: {
        runtimeType: "embedded"
      }
    });
  });
});

function createDeps(
  configOverrides: Partial<GatewayConfig> = {},
  options: {
    traceEvents?: WorkEvent[];
  } = {}
): {
  deps: RouteDeps;
  eventBus: EventBus;
  pauseSession: ReturnType<typeof vi.fn>;
  cancelSession: ReturnType<typeof vi.fn>;
} {
  const goal = createWorkGoal({
    id: "goal-1",
    description: "Gateway websocket tests"
  });
  const session = createWorkSession(goal, {
    id: "session-1"
  });
  session.state = "active";

  const eventBus = new EventBus();
  const store = new MemoryStore([session]);
  const pauseSession = vi.fn(async (sessionId: string) => {
    const current = await store.loadSession(sessionId);
    if (!current) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    current.state = "blocked";
    await store.saveSession(current);
    return current;
  });
  const cancelSession = vi.fn(async () => {});
  const runtime = createRuntime(cancelSession);
  const config = mergeConfig(configOverrides);
  const tokenStore = new TokenStore(config.auth.sessionTokenTtlMs ?? 3_600_000);

  const deps: RouteDeps = {
    store,
    engine: {
      async executeGoal(nextGoal: WorkGoal): Promise<WorkSession> {
        return createWorkSession(nextGoal, {
          id: "generated-session"
        });
      },
      pauseSession
    } as unknown as WorkEngine,
    runtime,
    eventBus,
    policy: {
      evaluate() {
        return {
          allowed: true,
          requiresConfirmation: false,
          riskLevel: "safe",
          reason: "allowed in tests"
        };
      },
      approveForSession() {}
    } satisfies SecurityPolicy,
    tokenStore,
    config,
    traceReader: {
      read: vi.fn(async () => options.traceEvents ?? [])
    } as unknown as RouteDeps["traceReader"],
    profileName: "platform",
    policyResolution: {
      profile: "platform",
      source: "global",
      allowRemote: true,
      defaultDeny: false
    } satisfies PolicyResolution,
    connectedClientsCount: 0
  };

  return {
    deps,
    eventBus,
    pauseSession,
    cancelSession
  };
}

function createRuntime(cancelSession: ReturnType<typeof vi.fn>): AgentRuntime {
  return {
    type: "embedded",
    async initSession(goal: WorkGoal) {
      return createWorkSession(goal);
    },
    async pauseSession() {},
    async resumeSession() {},
    cancelSession,
    async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
      return {
        schemaVersion: 2,
        snapshotId: `snapshot-${sessionId}`,
        capturedAt: new Date(),
        session: createWorkSession(
          createWorkGoal({
            id: "goal-1",
            description: "snapshot"
          }),
          {
            id: sessionId
          }
        ),
        runtimeContext: {
          pendingResults: []
        }
      };
    },
    async hydrateSession(snapshot: SessionSnapshot) {
      return snapshot.session;
    },
    async getMetadata() {
      return {
        runtimeType: "embedded" as const
      };
    },
    async loadContext() {},
    async requestNextAction() {
      return {
        kind: "blocked" as const,
        reason: "unsupported in tests"
      };
    },
    async ingestToolResult() {},
    signalCompletion() {},
    signalBlocked() {}
  };
}

function mergeConfig(configOverrides: Partial<GatewayConfig>): GatewayConfig {
  return {
    port: 4321,
    host: "127.0.0.1",
    auth: {
      apiKey: "secret",
      defaultPermissions: [
        "sessions.list",
        "sessions.read",
        "sessions.control",
        "sessions.approve",
        "goals.submit",
        "config.read"
      ],
      enableRuntimeProxy: false,
      ...configOverrides.auth
    },
    backfillEventCount: 50,
    wsAuthTimeoutMs: 5_000,
    tokenSweepIntervalMs: 30_000,
    ...configOverrides
  };
}

function createEvent<T extends WorkEvent["type"]>(
  id: string,
  sessionId: string,
  type: T,
  payload: Extract<WorkEvent, { type: T }>["payload"]
): Extract<WorkEvent, { type: T }> {
  return {
    id,
    timestamp: new Date(),
    sessionId,
    goalId: "goal-1",
    type,
    sourceLayer: "work-core",
    payload
  } as Extract<WorkEvent, { type: T }>;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeWebSocket extends EventEmitter {
  readonly sentMessages: unknown[] = [];
  closed = false;

  send(data: string | Buffer): void {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : data;
    this.sentMessages.push(JSON.parse(text));
  }

  close(): void {
    this.closed = true;
    this.emit("close");
  }

  receive(payload: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(payload), "utf8"));
  }
}

class MemoryStore implements StateStore {
  constructor(private readonly sessions: WorkSession[]) {}

  async saveSession(session: WorkSession): Promise<void> {
    const index = this.sessions.findIndex((entry) => entry.id === session.id);
    if (index >= 0) {
      this.sessions[index] = structuredClone(session);
      return;
    }
    this.sessions.push(structuredClone(session));
  }

  async loadSession(sessionId: string): Promise<WorkSession | null> {
    const session = this.sessions.find((entry) => entry.id === sessionId);
    return session ? structuredClone(session) : null;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.sessions.map((session) => ({
      id: session.id,
      goalId: session.goalId,
      ...(session.namedGoalId ? { namedGoalId: session.namedGoalId } : {}),
      state: session.state,
      updatedAt: session.updatedAt
    }));
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
