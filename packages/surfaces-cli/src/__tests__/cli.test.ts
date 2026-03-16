import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const executeGoal = vi.fn(async () => ({ state: "completed" }));
  const listSessions = vi.fn(async () => []);
  const loadSession = vi.fn(async () => null);
  const createLocalWorkEngine = vi.fn(() => ({
    engine: {
      executeGoal
    },
    store: {
      listSessions,
      loadSession
    }
  }));

  return {
    executeGoal,
    listSessions,
    loadSession,
    createLocalWorkEngine
  };
});

vi.mock("../factory.js", () => ({
  createLocalWorkEngine: mocks.createLocalWorkEngine
}));

import { buildCli } from "../cli.js";

const tempDirs: string[] = [];

afterEach(() => {
  mocks.executeGoal.mockClear();
  mocks.listSessions.mockClear();
  mocks.loadSession.mockClear();
  mocks.createLocalWorkEngine.mockClear();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildCli", () => {
  it("reuses a single config object during run", async () => {
    const configFactory = vi.fn(() => ({
      workspaceRoot: "/workspace",
      dataDir: "/workspace/.octopus",
      runtime: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-6",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(configFactory);

    await program.parseAsync(["run", "inspect repo"], { from: "user" });

    expect(configFactory).toHaveBeenCalledTimes(1);
    expect(mocks.createLocalWorkEngine).toHaveBeenCalledTimes(1);
    expect(mocks.executeGoal).toHaveBeenCalledWith(expect.anything(), {
      workspaceRoot: "/workspace"
    });
    stdout.mockRestore();
  });

  it("supports a config command that reports the effective runtime configuration", async () => {
    const configFactory = vi.fn(() => ({
      workspaceRoot: "/workspace",
      dataDir: "/workspace/.octopus",
      runtime: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-6",
        apiKey: "",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: false
      },
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(configFactory);

    await program.parseAsync(["config"], { from: "user" });

    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"apiKeyConfigured": false')
    );
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"validationErrors": [')
    );
    stdout.mockRestore();
  });

  it("persists runtime values through config set", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-cli-"));
    tempDirs.push(workspaceRoot);

    const configFactory = vi.fn(() => ({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus"),
      runtime: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-6",
        apiKey: "",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: false
      },
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(configFactory);

    await program.parseAsync(["config", "set", "apiKey", "secret-key"], { from: "user" });

    const saved = JSON.parse(await readFile(join(workspaceRoot, ".octopus", "config.json"), "utf8")) as Record<string, unknown>;
    expect(saved.apiKey).toBe("secret-key");
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"updatedKey": "apiKey"'));
    stdout.mockRestore();
  });

  it("persists the selected safe-local profile through config set", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-cli-"));
    tempDirs.push(workspaceRoot);

    const configFactory = vi.fn(() => ({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus"),
      runtime: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-6",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(configFactory);

    await program.parseAsync(["config", "set", "profile", "safe-local"], { from: "user" });

    const saved = JSON.parse(await readFile(join(workspaceRoot, ".octopus", "config.json"), "utf8")) as Record<string, unknown>;
    expect(saved.profile).toBe("safe-local");
    stdout.mockRestore();
  });

  it("rejects unsupported profile values", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-cli-"));
    tempDirs.push(workspaceRoot);

    const configFactory = vi.fn(() => ({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus"),
      runtime: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-6",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const program = buildCli(configFactory);

    await expect(
      program.parseAsync(["config", "set", "profile", "vibe"], { from: "user" })
    ).rejects.toThrow(/safe-local/i);
  });
});
