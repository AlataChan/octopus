import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRuntime, SessionSnapshot } from "@octopus/agent-runtime";
import { EventBus } from "@octopus/observability";
import type { SecurityPolicy, PolicyResolution } from "@octopus/security";
import type { SnapshotSummary, StateStore } from "@octopus/state-store";
import { createWorkGoal, createWorkSession, type Artifact, type SessionSummary, type WorkGoal, type WorkSession } from "@octopus/work-contracts";
import type { WorkEngine } from "@octopus/work-core";

import { GatewayServer } from "../server.js";
import type { GatewayConfig } from "../types.js";

const servers: GatewayServer[] = [];
const serverSpies: Array<ReturnType<typeof vi.spyOn>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      await server.stop();
    })
  );
  serverSpies.splice(0).forEach((spy) => spy.mockRestore());
});

describe("GatewayServer", () => {
  it("starts and stops cleanly", async () => {
    const server = createGatewayServer();
    servers.push(server);
    installFakeNodeServer(server);

    await server.start();

    expect(server.origin).toContain("127.0.0.1");

    await expect(server.stop()).resolves.toBeUndefined();
  });

  it("rejects safe-local and forces vibe to loopback", async () => {
    const rejected = createGatewayServer({}, "safe-local", {
      profile: "safe-local",
      source: "builtin",
      allowRemote: false,
      defaultDeny: false
    });

    await expect(rejected.start()).rejects.toThrow(/vibe|platform/i);

    const vibeServer = createGatewayServer(
      {
        host: "0.0.0.0"
      },
      "vibe",
      {
        profile: "vibe",
        source: "builtin",
        allowRemote: false,
        defaultDeny: false
      }
    );
    servers.push(vibeServer);
    installFakeNodeServer(vibeServer);

    await vibeServer.start();

    expect(vibeServer.origin).toContain("127.0.0.1");
  });

  it("serves health without auth", async () => {
    const server = createGatewayServer();
    const response = await dispatch(server, "GET", "/health");

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", activeSessions: 1 });
  });

  it("rejects token mint without API key auth", async () => {
    const server = createGatewayServer();
    const response = await dispatch(server, "POST", "/auth/token");

    expect(response.statusCode).toBe(401);
  });

  it("lists sessions with a valid API key", async () => {
    const server = createGatewayServer();
    const response = await dispatch(server, "GET", "/api/sessions", undefined, {
      "x-api-key": "secret"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "session-1",
        state: "active"
      })
    ]);
  });

  it("mints tokens for authenticated API key clients", async () => {
    const server = createGatewayServer();
    const response = await dispatch(server, "POST", "/auth/token", undefined, {
      "x-api-key": "secret"
    });
    const body = response.body as { token: string; expiresAt: string };

    expect(response.statusCode).toBe(200);
    expect(body.token).toBeTruthy();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("mints scoped tokens when permissions are requested", async () => {
    const server = createGatewayServer();
    const mint = await dispatch(
      server,
      "POST",
      "/auth/token",
      { permissions: ["sessions.read"] },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );
    const token = (mint.body as { token: string }).token;

    const listResponse = await dispatch(server, "GET", "/api/sessions", undefined, {
      authorization: `Bearer ${token}`
    });
    const getResponse = await dispatch(server, "GET", "/api/sessions/session-1", undefined, {
      authorization: `Bearer ${token}`
    });

    expect(mint.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(403);
    expect(getResponse.statusCode).toBe(200);
  });

  it("returns 403 when permission is missing", async () => {
    const server = createGatewayServer({
      auth: {
        apiKey: "secret",
        defaultPermissions: []
      }
    });
    const response = await dispatch(server, "GET", "/api/sessions", undefined, {
      "x-api-key": "secret"
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns 404 and 400 for not found and bad request cases", async () => {
    const server = createGatewayServer();
    const missing = await dispatch(server, "GET", "/api/sessions/missing", undefined, {
      "x-api-key": "secret"
    });
    const invalidControl = await dispatch(
      server,
      "POST",
      "/api/sessions/session-1/control",
      { action: "invalid" },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(missing.statusCode).toBe(404);
    expect(invalidControl.statusCode).toBe(400);
  });
});

async function dispatch(
  server: GatewayServer,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: unknown }> {
  const req = createRequest(method, url, headers, body);
  const res = createResponse();
  await (server as unknown as { handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> }).handleRequest(
    req,
    res as unknown as ServerResponse
  );

  return {
    statusCode: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null
  };
}

function createRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown
): IncomingMessage {
  const stream = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")]
  ) as IncomingMessage;
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  Object.assign(stream, {
    socket: {
      remoteAddress: "127.0.0.1"
    }
  });
  return stream;
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      if (chunk) {
        this.body += chunk;
      }
    }
  };
}

function installFakeNodeServer(server: GatewayServer): void {
  const fake = new FakeNodeServer();
  const spy = vi
    .spyOn(server as unknown as { createNodeServer(): unknown }, "createNodeServer")
    .mockReturnValue(fake as unknown);
  serverSpies.push(spy);
}

function createGatewayServer(
  configOverrides: Partial<GatewayConfig> = {},
  profileName: "safe-local" | "vibe" | "platform" = "platform",
  policyResolution: PolicyResolution = {
    profile: "platform",
    source: "global",
    allowRemote: true,
    defaultDeny: false
  }
): GatewayServer {
  const session = createWorkSession(createWorkGoal({ id: "goal-1", description: "Demo" }), {
    id: "session-1"
  });
  session.state = "active";

  const store = new MemoryStore([session]);
  const eventBus = new EventBus();
  const engine = {
    async executeGoal(goal: WorkGoal): Promise<WorkSession> {
      return createWorkSession(goal, { id: "generated-session" });
    },
    async pauseSession(sessionId: string): Promise<WorkSession> {
      const current = await store.loadSession(sessionId);
      if (!current) {
        throw new Error(`Unknown session: ${sessionId}`);
      }
      current.state = "blocked";
      await store.saveSession(current);
      return current;
    }
  } as unknown as WorkEngine;

  const runtime: AgentRuntime = {
    type: "embedded",
    async initSession(goal: WorkGoal) {
      return createWorkSession(goal);
    },
    async pauseSession() {},
    async resumeSession() {},
    async cancelSession() {},
    async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
      const current = await store.loadSession(sessionId);
      if (!current) {
        throw new Error(`Unknown session: ${sessionId}`);
      }
      return {
        schemaVersion: 2,
        snapshotId: `snapshot-${sessionId}`,
        capturedAt: new Date(),
        session: current,
        runtimeContext: {
          pendingResults: []
        }
      };
    },
    async hydrateSession(snapshot: SessionSnapshot) {
      return snapshot.session;
    },
    async getMetadata() {
      return { runtimeType: "embedded" as const };
    },
    async loadContext() {},
    async requestNextAction() {
      return { kind: "blocked" as const, reason: "unsupported in gateway tests" };
    },
    async ingestToolResult() {},
    signalCompletion() {},
    signalBlocked() {}
  };

  const policy: SecurityPolicy = {
    evaluate() {
      return {
        allowed: true,
        requiresConfirmation: false,
        riskLevel: "safe",
        reason: "allowed in tests"
      };
    },
    approveForSession() {}
  };

  return new GatewayServer(
    {
      port: 0,
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
        ]
      },
      ...configOverrides
    },
    engine,
    runtime,
    store,
    eventBus,
    policy,
    profileName,
    policyResolution
  );
}

class MemoryStore implements StateStore {
  constructor(private sessions: WorkSession[]) {}

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

class FakeNodeServer extends EventEmitter {
  private readonly info: AddressInfo = {
    address: "127.0.0.1",
    family: "IPv4",
    port: 4321
  };

  listen(_port: number, _host: string, callback: () => void): this {
    callback();
    return this;
  }

  close(callback: (error?: Error) => void): this {
    callback();
    return this;
  }

  address(): AddressInfo {
    return this.info;
  }
}
