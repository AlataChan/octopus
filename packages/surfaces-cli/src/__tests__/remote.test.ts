import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@octopus/eval-runner", () => ({
  loadEvalSuite: vi.fn(async () => []),
  EvalRunner: vi.fn().mockImplementation(() => ({ runSuite: vi.fn(async () => []) })),
  buildReport: vi.fn(() => ({ id: "run-test", suite: "", results: [], summary: { total: 0, passed: 0, failed: 0, passRate: 0 } })),
  saveReport: vi.fn(async () => {}),
  loadReport: vi.fn(async () => null),
  listReports: vi.fn(async () => []),
}));

import type { GatewayApp, GatewayConfigSection, LocalAppConfig } from "../factory.js";
import { buildCli } from "../cli.js";
import { RemoteClient } from "../remote-client.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("RemoteClient", () => {
  it("lists sessions with the API key header", async () => {
    const fetchFn = vi.fn(async () => createJsonResponse([
      {
        id: "session-1",
        goalId: "goal-1",
        state: "active",
        updatedAt: "2026-03-19T00:00:00.000Z"
      }
    ]));
    const client = new RemoteClient(
      {
        gatewayUrl: "https://octopus.example.com",
        apiKey: "remote-secret"
      },
      {
        fetchFn
      }
    );

    await client.listSessions();

    expect(fetchFn).toHaveBeenCalledWith(
      "https://octopus.example.com/api/sessions",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-API-Key": "remote-secret"
        })
      })
    );
  });

  it("submits goals with the correct request body", async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({
      sessionId: "session-1",
      goalId: "goal-1",
      state: "created"
    }));
    const client = new RemoteClient(
      {
        gatewayUrl: "https://octopus.example.com",
        apiKey: "remote-secret"
      },
      {
        fetchFn
      }
    );

    await client.submitGoal("Inspect repo");

    expect(fetchFn).toHaveBeenCalledWith(
      "https://octopus.example.com/api/goals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ description: "Inspect repo" })
      })
    );
  });
});

describe("remote CLI commands", () => {
  it("uses the provided API key for remote sessions", async () => {
    const listSessions = vi.fn(async () => []);
    const createRemoteClient = vi.fn(() => ({
      listSessions,
      getSession: vi.fn(),
      submitGoal: vi.fn(),
      controlSession: vi.fn(),
      approveSession: vi.fn(),
      mintToken: vi.fn(),
      attachToSession: vi.fn()
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(
      () => createCliConfig({
        gateway: {
          port: 4321,
          host: "127.0.0.1",
          apiKey: ""
        }
      }),
      {
        createRemoteClient
      }
    );

    await program.parseAsync(["remote", "sessions", "https://octopus.example.com", "--api-key", "remote-secret"], {
      from: "user"
    });

    expect(createRemoteClient).toHaveBeenCalledWith({
      gatewayUrl: "https://octopus.example.com",
      apiKey: "remote-secret"
    });
    expect(listSessions).toHaveBeenCalledTimes(1);
    stdout.mockRestore();
  });

  it("rejects gateway run when the profile is safe-local", async () => {
    const createGatewayApp = vi.fn();
    const program = buildCli(
      () =>
        createCliConfig({
          profile: "safe-local",
          gateway: {
            port: 4321,
            host: "127.0.0.1",
            apiKey: "gateway-secret"
          }
        }),
      {
        createGatewayApp
      }
    );

    await expect(program.parseAsync(["gateway", "run"], { from: "user" })).rejects.toThrow(/vibe|platform/i);
    expect(createGatewayApp).not.toHaveBeenCalled();
  });

  it("starts the gateway and stops it when the shutdown signal resolves", async () => {
    let releaseStop!: () => void;
    const waitForGatewayStop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        })
    );
    const gatewayServer = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {})
    };
    const flushTraces = vi.fn(async () => {});
    const createGatewayApp = vi.fn(
      () =>
        ({
          gatewayServer,
          flushTraces
        }) as unknown as GatewayApp
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(
      () =>
        createCliConfig({
          profile: "vibe",
          gateway: {
            port: 4321,
            host: "127.0.0.1",
            apiKey: "gateway-secret"
          }
        }),
      {
        createGatewayApp,
        waitForGatewayStop
      }
    );

    const runPromise = program.parseAsync(["gateway", "run"], { from: "user" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createGatewayApp).toHaveBeenCalledTimes(1);
    expect(gatewayServer.start).toHaveBeenCalledTimes(1);
    expect(waitForGatewayStop).toHaveBeenCalledTimes(1);

    releaseStop();
    await runPromise;

    expect(gatewayServer.stop).toHaveBeenCalledTimes(1);
    expect(flushTraces).toHaveBeenCalledTimes(1);
    stdout.mockRestore();
  });

  it("persists gateway.port through config set", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-cli-remote-"));
    tempDirs.push(workspaceRoot);

    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(() => ({
      ...createCliConfig(),
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus")
    }));

    await program.parseAsync(["config", "set", "gateway.port", "4545"], { from: "user" });

    const saved = JSON.parse(await readFile(join(workspaceRoot, ".octopus", "config.json"), "utf8")) as {
      gateway?: { port?: number };
    };
    expect(saved.gateway?.port).toBe(4545);
    stdout.mockRestore();
  });
});

function createCliConfig(overrides: Partial<LocalAppConfig> = {}): LocalAppConfig {
  return {
    workspaceRoot: "/workspace",
    dataDir: "/workspace/.octopus",
    runtime: {
      provider: "openai-compatible",
      model: "gpt-4o",
      apiKey: "test-key",
      maxTokens: 1_024,
      temperature: 0,
      allowModelApiCall: true
    },
    gateway: {
      port: 4321,
      host: "127.0.0.1",
      apiKey: "gateway-secret"
    } satisfies GatewayConfigSection,
    modelClient: {
      async completeTurn() {
        throw new Error("not used in CLI remote tests");
      }
    },
    ...overrides
  };
}

function createJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  } as Response;
}
