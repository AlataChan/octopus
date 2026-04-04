import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRuntime, SessionSnapshot } from "@octopus/agent-runtime";
import { EventBus } from "@octopus/observability";
import type { SecurityPolicy, PolicyResolution } from "@octopus/security";
import type { SnapshotSummary, StateStore } from "@octopus/state-store";
import { createWorkGoal, createWorkSession, type Artifact, type SessionSummary, type WorkGoal, type WorkSession } from "@octopus/work-contracts";
import type { WorkEngine } from "@octopus/work-core";

import { createPasswordHash } from "../auth.js";
import { GatewayServer } from "../server.js";
import type { GatewayConfig } from "../types.js";

const servers: GatewayServer[] = [];
const serverSpies: Array<ReturnType<typeof vi.spyOn>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      await server.stop();
    })
  );
  serverSpies.splice(0).forEach((spy) => spy.mockRestore());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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

  it("keeps a non-loopback vibe host when trusted proxy CIDRs are configured", async () => {
    const vibeServer = createGatewayServer(
      {
        host: "0.0.0.0",
        trustProxyCIDRs: ["172.30.0.0/24"]
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

    expect((vibeServer as unknown as { config: GatewayConfig }).config.host).toBe("0.0.0.0");
  });

  it("serves health without auth", async () => {
    const server = createGatewayServer();
    const response = await dispatch(server, "GET", "/health");

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", activeSessions: 1 });
  });

  it("serves setup status without auth", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-gateway-setup-"));
    tempDirs.push(workspaceRoot);
    const server = createGatewayServer({
      workspaceRoot,
      systemConfigDir: join(workspaceRoot, ".octopus", "system"),
      setupToken: "setup-secret"
    });

    const response = await dispatch(server, "GET", "/api/setup/status");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      initialized: false,
      workspaceWritable: true
    });
  });

  it("bypasses normal auth for setup validation but still requires the setup token header", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-gateway-setup-"));
    tempDirs.push(workspaceRoot);
    const server = createGatewayServer({
      workspaceRoot,
      systemConfigDir: join(workspaceRoot, ".octopus", "system"),
      setupToken: "setup-secret"
    });

    const missing = await dispatch(server, "POST", "/api/setup/validate-token");
    const valid = await dispatch(server, "POST", "/api/setup/validate-token", undefined, {
      "x-setup-token": "setup-secret"
    });

    expect(missing.statusCode).toBe(401);
    expect(valid.statusCode).toBe(200);
    expect(valid.body).toEqual({ valid: true });
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

  it("logs in configured browser users and revokes their tokens on logout", async () => {
    const passwordHash = await createPasswordHash("octopus-ops");
    const server = createGatewayServer({
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
        users: [
          {
            username: "ops1",
            passwordHash,
            role: "operator"
          }
        ]
      }
    });

    const login = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "ops1",
        password: "octopus-ops"
      },
      {
        "content-type": "application/json"
      }
    );
    const payload = login.body as { token: string; role: string; username: string };

    expect(login.statusCode).toBe(200);
    expect(payload).toMatchObject({
      role: "operator",
      username: "ops1"
    });

    const sessions = await dispatch(server, "GET", "/api/sessions", undefined, {
      authorization: `Bearer ${payload.token}`
    });
    expect(sessions.statusCode).toBe(200);

    const logout = await dispatch(server, "POST", "/auth/logout", undefined, {
      authorization: `Bearer ${payload.token}`
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await dispatch(server, "GET", "/api/sessions", undefined, {
      authorization: `Bearer ${payload.token}`
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("reports browser session state without returning 401 for stale tokens", async () => {
    const passwordHash = await createPasswordHash("octopus-ops");
    const server = createGatewayServer({
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
        users: [
          {
            username: "ops1",
            passwordHash,
            role: "operator"
          }
        ]
      }
    });

    const login = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "ops1",
        password: "octopus-ops"
      },
      {
        "content-type": "application/json"
      }
    );
    const token = (login.body as { token: string }).token;

    const stale = await dispatch(server, "GET", "/auth/session", undefined, {
      authorization: "Bearer stale-token"
    });
    const active = await dispatch(server, "GET", "/auth/session", undefined, {
      authorization: `Bearer ${token}`
    });

    expect(stale.statusCode).toBe(200);
    expect(stale.body).toEqual({
      authenticated: false
    });
    expect(active.statusCode).toBe(200);
    expect(active.body).toEqual({
      authenticated: true,
      role: "operator",
      username: "ops1"
    });
  });

  it("preserves password whitespace while still trimming usernames on browser login", async () => {
    const passwordHash = await createPasswordHash(" octopus-ops ");
    const server = createGatewayServer({
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
        users: [
          {
            username: "ops1",
            passwordHash,
            role: "operator"
          }
        ]
      }
    });

    const success = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: " ops1 ",
        password: " octopus-ops "
      },
      {
        "content-type": "application/json"
      }
    );
    const failure = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "ops1",
        password: "octopus-ops"
      },
      {
        "content-type": "application/json"
      }
    );

    expect(success.statusCode).toBe(200);
    expect(failure.statusCode).toBe(401);
  });

  it("enforces role-specific browser permissions", async () => {
    const viewerHash = await createPasswordHash("octopus-viewer");
    const server = createGatewayServer({
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
        users: [
          {
            username: "viewer1",
            passwordHash: viewerHash,
            role: "viewer"
          }
        ]
      }
    });

    const login = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "viewer1",
        password: "octopus-viewer"
      },
      {
        "content-type": "application/json"
      }
    );
    const token = (login.body as { token: string }).token;

    const listSessions = await dispatch(server, "GET", "/api/sessions", undefined, {
      authorization: `Bearer ${token}`
    });
    const submitGoal = await dispatch(
      server,
      "POST",
      "/api/goals",
      {
        description: "整理 README"
      },
      {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      }
    );

    expect(login.statusCode).toBe(200);
    expect(listSessions.statusCode).toBe(200);
    expect(submitGoal.statusCode).toBe(403);
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

  it("submits goals with release metadata and workspaceRoot from config", async () => {
    const { server, submitGoalCalls } = createGatewayServerHarness({
      workspaceRoot: "/workspace"
    });
    const response = await dispatch(
      server,
      "POST",
      "/api/goals",
      {
        description: "整理 README",
        namedGoalId: "readme-summary",
        taskTitle: "README 摘要"
      },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(response.statusCode).toBe(200);
    expect(submitGoalCalls).toHaveLength(1);
    expect(submitGoalCalls[0]?.goal.namedGoalId).toBe("readme-summary");
    expect(submitGoalCalls[0]?.options).toEqual({
      workspaceRoot: "/workspace",
      workspaceId: "default",
      configProfileId: "default",
      createdBy: "operator",
      taskTitle: "README 摘要"
    });
  });

  it("returns registered artifact content and rejects unknown or unsafe paths", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-gateway-artifacts-"));
    tempDirs.push(workspaceRoot);
    await writeFile(join(workspaceRoot, "PLAN.md"), "# PLAN\n\ncontent", "utf8");

    const { server, session } = createGatewayServerHarness({
      workspaceRoot
    });
    session.artifacts.push({
      id: "artifact-1",
      type: "document",
      path: "PLAN.md",
      description: "Current plan",
      createdAt: new Date("2026-03-19T15:42:36.000Z")
    });

    const ok = await dispatch(server, "GET", "/api/sessions/session-1/artifacts/content?path=PLAN.md", undefined, {
      "x-api-key": "secret"
    });
    const missing = await dispatch(server, "GET", "/api/sessions/session-1/artifacts/content?path=report.csv", undefined, {
      "x-api-key": "secret"
    });
    const unsafe = await dispatch(server, "GET", "/api/sessions/session-1/artifacts/content?path=../../etc/passwd", undefined, {
      "x-api-key": "secret"
    });

    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual(expect.objectContaining({
      path: "PLAN.md",
      contentType: "text/markdown; charset=utf-8",
      content: "# PLAN\n\ncontent"
    }));
    expect(missing.statusCode).toBe(404);
    expect(unsafe.statusCode).toBe(404);
  });

  it("resume calls engine.resumeBlockedSession with operator input", async () => {
    const { server, session, resumeBlockedSessionCalls } = createGatewayServerHarness();
    session.state = "blocked";

    const response = await dispatch(
      server,
      "POST",
      "/api/sessions/session-1/control",
      { action: "resume" },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(resumeBlockedSessionCalls).toHaveLength(1);
    expect(resumeBlockedSessionCalls[0]).toEqual({
      sessionId: "session-1",
      input: { kind: "operator" }
    });
  });

  it("resume returns 404 for unknown sessions", async () => {
    const { server } = createGatewayServerHarness();

    const response = await dispatch(
      server,
      "POST",
      "/api/sessions/unknown-session/control",
      { action: "resume" },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(response.statusCode).toBe(404);
  });

  it("resume returns 400 for non-blocked sessions", async () => {
    const { server, session } = createGatewayServerHarness();
    session.state = "active";

    const response = await dispatch(
      server,
      "POST",
      "/api/sessions/session-1/control",
      { action: "resume" },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(response.statusCode).toBe(400);
  });

  it("submits clarification answers over HTTP and resumes the blocked session", async () => {
    const { server, session, resumeBlockedSessionCalls } = createGatewayServerHarness();
    session.state = "blocked";

    const response = await dispatch(
      server,
      "POST",
      "/api/sessions/session-1/clarification",
      { answer: "yes, use /tmp" },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(resumeBlockedSessionCalls).toContainEqual({
      sessionId: "session-1",
      input: { kind: "clarification", answer: "yes, use /tmp" }
    });
  });

  it("returns 403 when clarification permission is missing", async () => {
    const { server, session } = createGatewayServerHarness({
      auth: {
        apiKey: "secret",
        defaultPermissions: ["sessions.read"]
      }
    });
    session.state = "blocked";

    const response = await dispatch(
      server,
      "POST",
      "/api/sessions/session-1/clarification",
      { answer: "yes, use /tmp" },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(response.statusCode).toBe(403);
  });

  it("surfaces role-aware status metadata for browser sessions", async () => {
    const passwordHash = await createPasswordHash("octopus-ops");
    const server = createGatewayServer({
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
        users: [
          {
            username: "ops1",
            passwordHash,
            role: "operator"
          }
        ]
      }
    });

    const login = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "ops1",
        password: "octopus-ops"
      },
      {
        "content-type": "application/json"
      }
    );
    const token = (login.body as { token: string }).token;
    const response = await dispatch(server, "GET", "/api/status", undefined, {
      authorization: `Bearer ${token}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      currentRole: "operator",
      currentOperator: "ops1",
      browserLoginConfigured: true,
      configuredUsers: 1,
      traceStreamingAvailable: false
    }));
  });

  it("rolls back a session from a selected checkpoint", async () => {
    const { server, session, store, executeGoalCalls } = createGatewayServerHarness();
    await store.saveSnapshot("session-1", {
      schemaVersion: 2,
      snapshotId: "snapshot-1",
      capturedAt: new Date("2026-03-19T16:00:00.000Z"),
      session,
      runtimeContext: {
        pendingResults: []
      }
    });

    const response = await dispatch(
      server,
      "POST",
      "/api/sessions/session-1/rollback",
      {
        snapshotId: "snapshot-1"
      },
      {
        "x-api-key": "secret",
        "content-type": "application/json"
      }
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      snapshotId: "snapshot-1"
    }));
    expect(executeGoalCalls).toContainEqual(expect.objectContaining({
      options: expect.objectContaining({
        workspaceRoot: "/workspace",
        resumeFrom: {
          sessionId: "session-1",
          snapshotId: "snapshot-1"
        }
      })
    }));
  });

  it("applies updated auth config and clears existing browser tokens", async () => {
    const oldHash = await createPasswordHash("old-password");
    const newHash = await createPasswordHash("new-password");
    const { server } = createGatewayServerHarness({
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
        users: [
          {
            username: "old-user",
            passwordHash: oldHash,
            role: "operator"
          }
        ]
      }
    });

    const oldLogin = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "old-user",
        password: "old-password"
      },
      {
        "content-type": "application/json"
      }
    );
    const oldToken = (oldLogin.body as { token: string }).token;

    expect(typeof (server as unknown as { applySystemConfig?: unknown }).applySystemConfig).toBe("function");

    (server as unknown as {
      applySystemConfig(update: {
        engine: WorkEngine;
        runtime: AgentRuntime;
        policy: SecurityPolicy;
        policyResolution: PolicyResolution;
        auth: {
          apiKey: string;
          users: Array<{ username: string; passwordHash: string; role: "viewer" | "operator" | "admin" }>;
        };
      }): void;
    }).applySystemConfig({
      ...createGatewayServerHarness({
        auth: {
          apiKey: "new-secret",
          defaultPermissions: [
            "sessions.list",
            "sessions.read",
            "sessions.control",
            "sessions.approve",
            "goals.submit",
            "config.read"
          ]
        }
      }),
      auth: {
        apiKey: "new-secret",
        users: [
          {
            username: "new-user",
            passwordHash: newHash,
            role: "operator"
          }
        ]
      }
    });

    const afterSwap = await dispatch(server, "GET", "/api/sessions", undefined, {
      authorization: `Bearer ${oldToken}`
    });
    const newLogin = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "new-user",
        password: "new-password"
      },
      {
        "content-type": "application/json"
      }
    );
    const apiKeySessions = await dispatch(server, "GET", "/api/sessions", undefined, {
      "x-api-key": "new-secret"
    });

    expect(afterSwap.statusCode).toBe(401);
    expect(newLogin.statusCode).toBe(200);
    expect(apiKeySessions.statusCode).toBe(200);
  });

  it("hot-swaps into ready mode after setup initialization without a server restart", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-gateway-hot-swap-"));
    tempDirs.push(workspaceRoot);

    const initial = createGatewayServerHarness({
      workspaceRoot,
      systemConfigDir: join(workspaceRoot, ".octopus", "system"),
      setupMode: true,
      setupToken: "setup-secret",
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
      }
    });

    let server!: GatewayServer;
    server = new (GatewayServer as unknown as {
      new(
        config: GatewayConfig,
        engine: WorkEngine,
        runtime: AgentRuntime,
        store: StateStore,
        eventBus: EventBus,
        policy: SecurityPolicy,
        profileName: "safe-local" | "vibe" | "platform",
        policyResolution: PolicyResolution,
        traceReader?: unknown,
        systemConfigApplier?: (systemConfig: {
          auth: {
            gatewayApiKey: string;
            users: Array<{ username: string; passwordHash: string; role: "viewer" | "operator" | "admin" }>;
          };
        }) => Promise<void>
      ): GatewayServer;
    })(
      {
        port: 0,
        host: "127.0.0.1",
        workspaceRoot,
        systemConfigDir: join(workspaceRoot, ".octopus", "system"),
        setupMode: true,
        setupToken: "setup-secret",
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
        }
      },
      initial.engine,
      initial.runtime,
      initial.store,
      new EventBus(),
      initial.policy,
      "vibe",
      initial.policyResolution,
      undefined,
      async (systemConfig) => {
        const replacement = createGatewayServerHarness({
          workspaceRoot,
          systemConfigDir: join(workspaceRoot, ".octopus", "system"),
          auth: {
            apiKey: systemConfig.auth.gatewayApiKey,
            defaultPermissions: [
              "sessions.list",
              "sessions.read",
              "sessions.control",
              "sessions.approve",
              "goals.submit",
              "config.read"
            ],
            users: systemConfig.auth.users
          }
        });

        (server as unknown as {
          applySystemConfig(update: {
            engine: WorkEngine;
            runtime: AgentRuntime;
            policy: SecurityPolicy;
            policyResolution: PolicyResolution;
            auth: {
              apiKey: string;
              users: Array<{ username: string; passwordHash: string; role: "viewer" | "operator" | "admin" }>;
            };
          }): void;
        }).applySystemConfig({
          engine: replacement.engine,
          runtime: replacement.runtime,
          policy: replacement.policy,
          policyResolution: replacement.policyResolution,
          auth: {
            apiKey: systemConfig.auth.gatewayApiKey,
            users: systemConfig.auth.users
          }
        });
      }
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"kind":"completion","evidence":"ok"}'
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
    );

    const initialize = await dispatch(
      server,
      "POST",
      "/api/setup/initialize",
      {
        runtime: {
          provider: "openai-compatible",
          model: "gpt-5.4",
          apiKey: "sk-test",
          baseUrl: "https://example.invalid/v1"
        },
        admin: {
          username: "admin",
          password: "octopus-admin"
        }
      },
      {
        "x-setup-token": "setup-secret",
        "content-type": "application/json"
      }
    );
    const login = await dispatch(
      server,
      "POST",
      "/auth/login",
      {
        username: "admin",
        password: "octopus-admin"
      },
      {
        "content-type": "application/json"
      }
    );
    const token = (login.body as { token: string }).token;
    const sessions = await dispatch(server, "GET", "/api/sessions", undefined, {
      authorization: `Bearer ${token}`
    });

    expect(initialize.statusCode).toBe(200);
    expect(login.statusCode).toBe(200);
    expect(sessions.statusCode).toBe(200);
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
  return createGatewayServerHarness(configOverrides, profileName, policyResolution).server;
}

function createGatewayServerHarness(
  configOverrides: Partial<GatewayConfig> = {},
  profileName: "safe-local" | "vibe" | "platform" = "platform",
  policyResolution: PolicyResolution = {
    profile: "platform",
    source: "global",
    allowRemote: true,
    defaultDeny: false
  }
): {
  server: GatewayServer;
  session: WorkSession;
  store: MemoryStore;
  engine: WorkEngine;
  runtime: AgentRuntime;
  policy: SecurityPolicy;
  policyResolution: PolicyResolution;
  executeGoalCalls: Array<{ goal: WorkGoal; options?: Record<string, unknown> }>;
  submitGoalCalls: Array<{ goal: WorkGoal; options?: Record<string, unknown> }>;
  resumeBlockedSessionCalls: Array<{ sessionId: string; input: unknown }>;
} {
  const session = createWorkSession(createWorkGoal({ id: "goal-1", description: "Demo" }), {
    id: "session-1"
  });
  session.state = "active";

  const store = new MemoryStore([session]);
  const eventBus = new EventBus();
  const executeGoalCalls: Array<{ goal: WorkGoal; options?: Record<string, unknown> }> = [];
  const submitGoalCalls: Array<{ goal: WorkGoal; options?: Record<string, unknown> }> = [];
  const resumeBlockedSessionCalls: Array<{ sessionId: string; input: unknown }> = [];
  const engine = {
    async submitGoal(goal: WorkGoal, options?: Record<string, unknown>): Promise<WorkSession> {
      submitGoalCalls.push({ goal, options });
      const created = createWorkSession(goal, { id: "generated-session" });
      created.state = "active";
      return created;
    },
    async executeGoal(goal: WorkGoal, options?: Record<string, unknown>): Promise<WorkSession> {
      executeGoalCalls.push({ goal, options });
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
    },
    async resumeBlockedSession(sessionId: string, input: unknown): Promise<WorkSession> {
      resumeBlockedSessionCalls.push({ sessionId, input });
      const current = await store.loadSession(sessionId);
      if (!current) {
        throw new Error(`Unknown session: ${sessionId}`);
      }
      if (current.state !== "blocked") {
        throw new Error(`Session ${sessionId} is not blocked (state: ${current.state})`);
      }
      current.state = "active";
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

  return {
    server: new GatewayServer(
      {
        port: 0,
        host: "127.0.0.1",
        workspaceRoot: "/workspace",
        systemConfigDir: "/workspace/.octopus/system",
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
    ),
    session,
    store,
    engine,
    runtime,
    policy,
    policyResolution,
    executeGoalCalls,
    submitGoalCalls,
    resumeBlockedSessionCalls
  };
}

class MemoryStore implements StateStore {
  private readonly snapshots = new Map<string, SessionSnapshot[]>();

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
    const current = this.snapshots.get(sessionId) ?? [];
    current.push(structuredClone(snapshot));
    this.snapshots.set(sessionId, current);
  }

  async loadSnapshot(sessionId: string, snapshotId?: string): Promise<SessionSnapshot | null> {
    const snapshots = this.snapshots.get(sessionId) ?? [];
    if (snapshots.length === 0) {
      return null;
    }

    if (!snapshotId) {
      return structuredClone(
        [...snapshots].sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())[0]!
      );
    }

    const match = snapshots.find((snapshot) => snapshot.snapshotId === snapshotId);
    return match ? structuredClone(match) : null;
  }

  async listSnapshots(sessionId: string): Promise<SnapshotSummary[]> {
    return [...(this.snapshots.get(sessionId) ?? [])]
      .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())
      .map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        capturedAt: snapshot.capturedAt,
        schemaVersion: snapshot.schemaVersion
      }));
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
