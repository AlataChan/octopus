import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyPasswordHash } from "../auth.js";
import type { GatewayConfig, SystemConfig } from "../types.js";

type HandleSetupStatus = (deps: RouteDepsLike) => Promise<{
  initialized: boolean;
  workspaceWritable: boolean;
}>;

type HandleValidateToken = (deps: RouteDepsLike) => Promise<{ valid: boolean }>;

type HandleValidateRuntime = (
  deps: RouteDepsLike,
  body: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }
) => Promise<{ valid: boolean; latencyMs?: number; error?: string }>;

type HandleInitialize = (
  deps: RouteDepsLike,
  body: {
    runtime: {
      provider: string;
      model: string;
      apiKey: string;
      baseUrl?: string;
    };
    admin: {
      username: string;
      password: string;
    };
    additionalUsers?: Array<{
      username: string;
      password: string;
      role: "operator" | "viewer";
    }>;
  }
) => Promise<{ initialized: true }>;

type ReadSystemConfig = (configDir: string) => Promise<SystemConfig | null>;

interface RouteDepsLike {
  config: GatewayConfig;
  workspaceRoot: string;
}

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.OCTOPUS_SETUP_TOKEN;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("setup routes", () => {
  it("exports setup handlers from the gateway entrypoint", async () => {
    const gateway = (await import("../index.js")) as Record<string, unknown>;

    expect(typeof gateway.handleSetupStatus).toBe("function");
    expect(typeof gateway.handleValidateToken).toBe("function");
    expect(typeof gateway.handleValidateRuntime).toBe("function");
    expect(typeof gateway.handleInitialize).toBe("function");
  });

  it("reports setup status from the workspace and persistent config", async () => {
    const { handleSetupStatus, handleInitialize } = await loadSetupHelpers();
    const workspaceRoot = await createTempDir();
    const deps = createRouteDeps(workspaceRoot);

    expect(await handleSetupStatus(deps)).toEqual({
      initialized: false,
      workspaceWritable: true
    });

    vi.stubGlobal("fetch", vi.fn(async () => createRuntimeResponse()));
    await handleInitialize(deps, createInitializeBody());

    expect(await handleSetupStatus(deps)).toEqual({
      initialized: true,
      workspaceWritable: true
    });
  });

  it("validates the setup token before initialization and returns gone after initialization", async () => {
    const { handleValidateToken, handleInitialize } = await loadSetupHelpers();
    const workspaceRoot = await createTempDir();
    const deps = createRouteDeps(workspaceRoot);

    expect(await handleValidateToken(deps)).toEqual({ valid: true });

    vi.stubGlobal("fetch", vi.fn(async () => createRuntimeResponse()));
    await handleInitialize(deps, createInitializeBody());

    await expect(handleValidateToken(deps)).rejects.toMatchObject({
      statusCode: 410
    });
  });

  it("validates runtime settings with an OpenAI-compatible probe", async () => {
    const { handleValidateRuntime } = await loadSetupHelpers();
    const workspaceRoot = await createTempDir();
    const deps = createRouteDeps(workspaceRoot);

    vi.stubGlobal("fetch", vi.fn(async () => createRuntimeResponse()));

    const result = await handleValidateRuntime(deps, {
      provider: "openai-compatible",
      model: "gpt-5.4",
      apiKey: "sk-test",
      baseUrl: "https://example.invalid/v1"
    });

    expect(result.valid).toBe(true);
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it("writes persistent config, hashes passwords, and clears the setup token during initialization", async () => {
    const { handleInitialize, readSystemConfig } = await loadSetupHelpers();
    const workspaceRoot = await createTempDir();
    const deps = createRouteDeps(workspaceRoot);
    process.env.OCTOPUS_SETUP_TOKEN = "setup-secret";

    vi.stubGlobal("fetch", vi.fn(async () => createRuntimeResponse()));

    await expect(handleInitialize(deps, createInitializeBody())).resolves.toEqual({
      initialized: true
    });

    const config = await readSystemConfig(join(workspaceRoot, ".octopus", "system"));

    expect(config).not.toBeNull();
    expect(config?.auth.gatewayApiKey).toBeTruthy();
    expect(config?.auth.users).toHaveLength(2);
    expect(config?.meta).toEqual(expect.objectContaining({
      initialized: true,
      initializedBy: "admin",
      schemaVersion: 1
    }));
    expect(await verifyPasswordHash("octopus-admin", config!.auth.users[0]!.passwordHash)).toBe(true);
    expect(await verifyPasswordHash("octopus-ops", config!.auth.users[1]!.passwordHash)).toBe(true);
    expect(process.env.OCTOPUS_SETUP_TOKEN).toBeUndefined();
  });

  it("returns gone when initialization is requested after the system is already ready", async () => {
    const { handleInitialize } = await loadSetupHelpers();
    const workspaceRoot = await createTempDir();
    const deps = createRouteDeps(workspaceRoot);

    vi.stubGlobal("fetch", vi.fn(async () => createRuntimeResponse()));

    await handleInitialize(deps, createInitializeBody());

    await expect(handleInitialize(deps, createInitializeBody())).rejects.toMatchObject({
      statusCode: 410
    });
  });
});

async function loadSetupHelpers(): Promise<{
  handleSetupStatus: HandleSetupStatus;
  handleValidateToken: HandleValidateToken;
  handleValidateRuntime: HandleValidateRuntime;
  handleInitialize: HandleInitialize;
  readSystemConfig: ReadSystemConfig;
}> {
  const gateway = (await import("../index.js")) as Record<string, unknown>;

  expect(typeof gateway.handleSetupStatus).toBe("function");
  expect(typeof gateway.handleValidateToken).toBe("function");
  expect(typeof gateway.handleValidateRuntime).toBe("function");
  expect(typeof gateway.handleInitialize).toBe("function");
  expect(typeof gateway.readSystemConfig).toBe("function");

  return {
    handleSetupStatus: gateway.handleSetupStatus as HandleSetupStatus,
    handleValidateToken: gateway.handleValidateToken as HandleValidateToken,
    handleValidateRuntime: gateway.handleValidateRuntime as HandleValidateRuntime,
    handleInitialize: gateway.handleInitialize as HandleInitialize,
    readSystemConfig: gateway.readSystemConfig as ReadSystemConfig
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "octopus-setup-routes-"));
  tempDirs.push(dir);
  return dir;
}

function createRouteDeps(workspaceRoot: string): RouteDepsLike {
  return {
    config: {
      port: 0,
      host: "127.0.0.1",
      workspaceRoot,
      systemConfigDir: join(workspaceRoot, ".octopus", "system"),
      setupToken: "setup-secret",
      auth: {
        apiKey: "secret",
        defaultPermissions: []
      }
    },
    workspaceRoot
  } as RouteDepsLike;
}

function createInitializeBody() {
  return {
    runtime: {
      provider: "openai-compatible",
      model: "gpt-5.4",
      apiKey: "sk-test",
      baseUrl: "https://example.invalid/v1"
    },
    admin: {
      username: "admin",
      password: "octopus-admin"
    },
    additionalUsers: [
      {
        username: "ops1",
        password: "octopus-ops",
        role: "operator" as const
      }
    ]
  };
}

function createRuntimeResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: '{"kind":"completion","evidence":"ok"}'
          }
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5
      }
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}
