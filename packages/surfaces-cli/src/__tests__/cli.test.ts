import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpToolDefinition } from "@octopus/adapter-mcp";
import type { SnapshotSummary } from "@octopus/state-store";
import type { WorkSession } from "@octopus/work-contracts";
import type { LocalApp, LocalAppConfig } from "../factory.js";

const mocks = vi.hoisted(() => {
  const executeGoal = vi.fn<() => Promise<WorkSession>>(async () => ({
    id: "session-1",
    goalId: "goal-1",
    namedGoalId: "daily-report",
    state: "completed" as const,
    items: [],
    observations: [],
    artifacts: [],
    transitions: [],
    createdAt: new Date("2026-03-18T00:00:00.000Z"),
    updatedAt: new Date("2026-03-18T00:00:00.000Z")
  }));
  const listSessions = vi.fn(async () => []);
  const loadSession = vi.fn<() => Promise<WorkSession | null>>(async () => null);
  const listSnapshots = vi.fn<() => Promise<SnapshotSummary[]>>(async () => []);
  const createLocalWorkEngine = vi.fn<(config: LocalAppConfig) => LocalApp>(() =>
    ({
      engine: {
        executeGoal
      },
      store: {
        listSessions,
        loadSession,
        listSnapshots
      },
      runtime: {
        requestNextAction: vi.fn()
      },
      substrate: {},
      policy: {
        evaluate: vi.fn(),
        approveForSession: vi.fn()
      },
      policyResolution: {
        profile: "safe-local" as const,
        source: "builtin" as const,
        defaultDeny: false
      },
      eventBus: {
        emit: vi.fn(),
        onAny: vi.fn(() => () => {})
      },
      flushTraces: vi.fn(async () => {})
    }) as unknown as LocalApp
  );
  const createGatewayApp = vi.fn(() =>
    ({
      gatewayServer: {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {})
      },
      flushTraces: vi.fn(async () => {})
    }) as unknown as LocalApp
  );
  const createMcpSecurityClassifier = vi.fn(() => ({
    classifyTool: vi.fn(() => ({ allowed: true, securityCategory: "network" as const }))
  }));
  const startAll = vi.fn(async () => {});
  const stopAll = vi.fn(async () => {});
  const getAllTools = vi.fn<() => McpToolDefinition[]>(() => []);
  const createMcpServerManager = vi.fn(() =>
    ({
      startAll,
      stopAll,
      getAllTools
    }) as never
  );

  return {
    executeGoal,
    listSessions,
    loadSession,
    listSnapshots,
    createLocalWorkEngine,
    createGatewayApp,
    createMcpSecurityClassifier,
    createMcpServerManager,
    startAll,
    stopAll,
    getAllTools
  };
});

vi.mock("../factory.js", () => ({
  createLocalWorkEngine: mocks.createLocalWorkEngine,
  createGatewayApp: mocks.createGatewayApp
}));

import { buildCli } from "../cli.js";

const tempDirs: string[] = [];

afterEach(() => {
  mocks.executeGoal.mockClear();
  mocks.listSessions.mockClear();
  mocks.loadSession.mockClear();
  mocks.listSnapshots.mockClear();
  mocks.createLocalWorkEngine.mockClear();
  mocks.createMcpSecurityClassifier.mockClear();
  mocks.createMcpServerManager.mockClear();
  mocks.startAll.mockClear();
  mocks.stopAll.mockClear();
  mocks.getAllTools.mockClear();
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

  it("applies the profile flag override for run", async () => {
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
      profile: "safe-local" as const,
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(configFactory);

    await program.parseAsync(["run", "--profile", "vibe", "inspect repo"], { from: "user" });

    expect(mocks.createLocalWorkEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "vibe"
      })
    );
    stdout.mockRestore();
  });

  it("documents that --policy-file implies the platform profile in help output", () => {
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
    const program = buildCli(configFactory);
    const runHelp = program.commands.find((command) => command.name() === "run")?.helpInformation() ?? "";

    expect(runHelp).toMatch(/platform policy file/i);
    expect(runHelp).toMatch(/implies --profile platform/i);
  });

  it("rejects a non-platform profile when --policy-file is provided", async () => {
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
      profile: "safe-local" as const,
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const program = buildCli(configFactory);

    await expect(
      program.parseAsync(["run", "--profile", "vibe", "--policy-file", "/tmp/policy.json", "inspect repo"], { from: "user" })
    ).rejects.toThrow(/--policy-file requires --profile platform or no --profile/i);
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

  it("persists the selected vibe profile through config set", async () => {
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

    await program.parseAsync(["config", "set", "profile", "vibe"], { from: "user" });

    const saved = JSON.parse(await readFile(join(workspaceRoot, ".octopus", "config.json"), "utf8")) as Record<string, unknown>;
    expect(saved.profile).toBe("vibe");
    stdout.mockRestore();
  });

  it("restores from the snapshot closest to the requested timestamp", async () => {
    mocks.loadSession.mockResolvedValueOnce({
      id: "session-1",
      goalId: "goal-1",
      namedGoalId: "daily-report",
      state: "blocked",
      items: [],
      observations: [],
      artifacts: [],
      transitions: [],
      createdAt: new Date("2026-03-18T00:00:00.000Z"),
      updatedAt: new Date("2026-03-18T00:00:00.000Z")
    });
    mocks.listSnapshots.mockResolvedValueOnce([
      {
        snapshotId: "snapshot-newer",
        capturedAt: new Date("2026-03-18T12:00:00.000Z"),
        schemaVersion: 2
      },
      {
        snapshotId: "snapshot-older",
        capturedAt: new Date("2026-03-18T10:00:00.000Z"),
        schemaVersion: 2
      }
    ]);

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
      profile: "safe-local" as const,
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(configFactory);

    await program.parseAsync(["restore", "session-1", "--at", "2026-03-18T10:30:00.000Z"], { from: "user" });

    expect(mocks.executeGoal).toHaveBeenCalledWith(expect.anything(), {
      workspaceRoot: "/workspace",
      resumeFrom: {
        sessionId: "session-1",
        snapshotId: "snapshot-older"
      }
    });
    stdout.mockRestore();
  });

  it("rejects automation run when the profile is safe-local", async () => {
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
      profile: "safe-local" as const,
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const program = buildCli(configFactory);

    await expect(program.parseAsync(["automation", "run"], { from: "user" })).rejects.toThrow(/requires 'vibe' or 'platform'/i);
  });

  it("continues stopping later automation sources when an earlier stop fails", async () => {
    const stopCalls: string[] = [];
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
      profile: "vibe" as const,
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const program = buildCli(configFactory, {
      createLocalWorkEngine: mocks.createLocalWorkEngine,
      loadAutomationConfig: () => ({
        goals: {
          "daily-report": { description: "Generate report" },
          normalize: { description: "Normalize files" }
        },
        sources: [
          { type: "cron", namedGoalId: "daily-report", schedule: "0 9 * * 1-5" },
          { type: "watcher", namedGoalId: "normalize", watchPath: "./incoming", events: ["add"] }
        ]
      }),
      createCronSource: () => ({
        name: "cron:daily-report",
        sourceType: "cron",
        namedGoalId: "daily-report",
        async start() {},
        async stop() {
          stopCalls.push("cron");
          throw new Error("cron stop failed");
        }
      }),
      createWatcherSource: () => ({
        name: "watcher:normalize",
        sourceType: "watcher",
        namedGoalId: "normalize",
        async start() {},
        async stop() {
          stopCalls.push("watcher");
        }
      }),
      waitForAutomationStop: async () => {}
    });

    await expect(program.parseAsync(["automation", "run"], { from: "user" })).rejects.toThrow(/cron stop failed/i);
    expect(stopCalls).toEqual(["cron", "watcher"]);
  });

  it("surfaces both run and stop failures when they happen in the same automation run", async () => {
    const stopCalls: string[] = [];
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
      profile: "vibe" as const,
      modelClient: {
        async completeTurn() {
          throw new Error("not used in this test");
        }
      }
    }));
    const program = buildCli(configFactory, {
      createLocalWorkEngine: mocks.createLocalWorkEngine,
      loadAutomationConfig: () => ({
        goals: {
          "daily-report": { description: "Generate report" }
        },
        sources: [{ type: "cron", namedGoalId: "daily-report", schedule: "0 9 * * 1-5" }]
      }),
      createCronSource: () => ({
        name: "cron:daily-report",
        sourceType: "cron",
        namedGoalId: "daily-report",
        async start() {},
        async stop() {
          stopCalls.push("cron");
          throw new Error("cron stop failed");
        }
      }),
      createWatcherSource: () => {
        throw new Error("not used in this test");
      },
      waitForAutomationStop: async () => {
        throw new Error("runner failed");
      }
    });

    try {
      await program.parseAsync(["automation", "run"], { from: "user" });
      throw new Error("expected automation run to fail");
    } catch (error) {
      expect(stopCalls).toEqual(["cron"]);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/runner failed/i);
      expect((error as Error).message).toMatch(/cron stop failed/i);
      expect((error as Error & { cause?: unknown }).cause).toBeDefined();
    }
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
      program.parseAsync(["config", "set", "profile", "invalid"], { from: "user" })
    ).rejects.toThrow(/safe-local, vibe, platform/i);
  });

  it("lists configured MCP servers without connecting them", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(
      () => ({
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
        mcp: {
          servers: [
            {
              id: "filesystem",
              transport: "stdio"
            }
          ]
        },
        modelClient: {
          async completeTurn() {
            throw new Error("not used in this test");
          }
        }
      }),
      {
        createMcpSecurityClassifier: mocks.createMcpSecurityClassifier,
        createMcpServerManager: mocks.createMcpServerManager
      }
    );

    await program.parseAsync(["mcp", "list-servers"], { from: "user" });

    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"status": "not tested"')
    );
    expect(mocks.createMcpServerManager).not.toHaveBeenCalled();
    stdout.mockRestore();
  });

  it("lists allowed MCP tools through the manager when configured", async () => {
    mocks.getAllTools.mockReturnValueOnce([
      {
        serverId: "filesystem",
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object" },
        policy: { allowed: true }
      }
    ]);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const program = buildCli(
      () => ({
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
        mcp: {
          servers: [
            {
              id: "filesystem",
              transport: "stdio"
            }
          ]
        },
        modelClient: {
          async completeTurn() {
            throw new Error("not used in this test");
          }
        }
      }),
      {
        createMcpSecurityClassifier: mocks.createMcpSecurityClassifier,
        createMcpServerManager: mocks.createMcpServerManager
      }
    );

    await program.parseAsync(["mcp", "list-tools"], { from: "user" });

    expect(mocks.startAll).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"name": "read_file"')
    );
    expect(mocks.stopAll).toHaveBeenCalledTimes(1);
    stdout.mockRestore();
  });
});
