import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

interface SystemRuntimeConfigLike {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

interface GatewayUserAccountLike {
  username: string;
  passwordHash: string;
  role: "viewer" | "operator" | "admin";
}

interface SystemAuthConfigLike {
  gatewayApiKey: string;
  users: GatewayUserAccountLike[];
}

interface SystemMetaLike {
  initialized: boolean;
  initializedAt: string;
  initializedBy: string;
  schemaVersion: number;
}

interface SystemConfigLike {
  runtime: SystemRuntimeConfigLike;
  auth: SystemAuthConfigLike;
  meta: SystemMetaLike;
}

type ReadSystemConfig = (configDir: string) => Promise<SystemConfigLike | null>;
type WriteSystemConfig = (configDir: string, config: SystemConfigLike) => Promise<void>;
type IsInitialized = (configDir: string) => Promise<boolean>;
type IsWorkspaceWritable = (workspaceRoot: string) => Promise<boolean>;

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("system config helpers", () => {
  it("exports persistent config helpers from the gateway entrypoint", async () => {
    const gateway = (await import("../index.js")) as Record<string, unknown>;

    expect(typeof gateway.readSystemConfig).toBe("function");
    expect(typeof gateway.writeSystemConfig).toBe("function");
    expect(typeof gateway.isInitialized).toBe("function");
    expect(typeof gateway.isWorkspaceWritable).toBe("function");
  });

  it("returns null when the config directory does not exist", async () => {
    const { readSystemConfig } = await loadHelpers();
    const workspaceRoot = await createTempDir();

    const result = await readSystemConfig(join(workspaceRoot, ".octopus", "system"));

    expect(result).toBeNull();
  });

  it("writes and reads the persistent config files as a round-trip", async () => {
    const { readSystemConfig, writeSystemConfig } = await loadHelpers();
    const workspaceRoot = await createTempDir();
    const configDir = join(workspaceRoot, ".octopus", "system");
    const config = createSystemConfig();

    await writeSystemConfig(configDir, config);

    const [metaRaw, runtimeRaw, authRaw, hydrated] = await Promise.all([
      readFile(join(configDir, "meta.json"), "utf8"),
      readFile(join(configDir, "runtime.json"), "utf8"),
      readFile(join(configDir, "auth.json"), "utf8"),
      readSystemConfig(configDir)
    ]);

    expect(JSON.parse(metaRaw)).toEqual(config.meta);
    expect(JSON.parse(runtimeRaw)).toEqual(config.runtime);
    expect(JSON.parse(authRaw)).toEqual(config.auth);
    expect(hydrated).toEqual(config);
  });

  it("reports initialization based on meta.json", async () => {
    const { isInitialized, writeSystemConfig } = await loadHelpers();
    const workspaceRoot = await createTempDir();
    const configDir = join(workspaceRoot, ".octopus", "system");

    expect(await isInitialized(configDir)).toBe(false);

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "runtime.json"),
      JSON.stringify(createSystemConfig().runtime),
      "utf8"
    );
    await writeFile(join(configDir, "auth.json"), JSON.stringify(createSystemConfig().auth), "utf8");

    expect(await isInitialized(configDir)).toBe(false);

    await writeSystemConfig(configDir, createSystemConfig());

    expect(await isInitialized(configDir)).toBe(true);
  });

  it("checks whether a workspace root is writable", async () => {
    const { isWorkspaceWritable } = await loadHelpers();
    const workspaceRoot = await createTempDir();
    const missingRoot = join(workspaceRoot, "missing-root");

    expect(await isWorkspaceWritable(workspaceRoot)).toBe(true);
    expect(await isWorkspaceWritable(missingRoot)).toBe(false);
  });
});

async function loadHelpers(): Promise<{
  readSystemConfig: ReadSystemConfig;
  writeSystemConfig: WriteSystemConfig;
  isInitialized: IsInitialized;
  isWorkspaceWritable: IsWorkspaceWritable;
}> {
  const gateway = (await import("../index.js")) as Record<string, unknown>;

  expect(typeof gateway.readSystemConfig).toBe("function");
  expect(typeof gateway.writeSystemConfig).toBe("function");
  expect(typeof gateway.isInitialized).toBe("function");
  expect(typeof gateway.isWorkspaceWritable).toBe("function");

  return {
    readSystemConfig: gateway.readSystemConfig as ReadSystemConfig,
    writeSystemConfig: gateway.writeSystemConfig as WriteSystemConfig,
    isInitialized: gateway.isInitialized as IsInitialized,
    isWorkspaceWritable: gateway.isWorkspaceWritable as IsWorkspaceWritable
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "octopus-system-config-"));
  tempDirs.push(dir);
  return dir;
}

function createSystemConfig(): SystemConfigLike {
  return {
    runtime: {
      provider: "openai-compatible",
      model: "gpt-5.4",
      apiKey: "sk-test",
      baseUrl: "https://example.invalid/v1",
      maxTokens: 4096,
      temperature: 0.1
    },
    auth: {
      gatewayApiKey: "gateway-secret",
      users: [
        {
          username: "admin",
          passwordHash: "scrypt$16384$8$1$salt$hash",
          role: "admin"
        }
      ]
    },
    meta: {
      initialized: true,
      initializedAt: "2026-04-03T00:00:00.000Z",
      initializedBy: "admin",
      schemaVersion: 1
    }
  };
}
