import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkEvent } from "@octopus/observability";
import type { ActionHandler } from "@octopus/exec-substrate";

import { createLocalWorkEngine } from "../factory.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createLocalWorkEngine", () => {
  it("wires the phase 1 local engine from concrete adapters", async () => {
    const app = await createLocalWorkEngine({
      workspaceRoot: process.cwd(),
      dataDir: `${process.cwd()}/.octopus`,
      runtime: {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      modelClient: {
        async completeTurn() {
          return {
            response: { kind: "completion", evidence: "done" },
            telemetry: {
              endpoint: "https://openrouter.ai/api/v1/chat/completions",
              durationMs: 10,
              success: true
            }
          };
        }
      }
    });

    expect(typeof app.engine.executeGoal).toBe("function");
    expect(typeof app.runtime.requestNextAction).toBe("function");
    expect(typeof app.store.saveSession).toBe("function");
  });

  it("persists emitted events to the traces directory", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-factory-"));
    tempDirs.push(workspaceRoot);

    const app = await createLocalWorkEngine({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus"),
      runtime: {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      profile: "safe-local",
      modelClient: {
        async completeTurn() {
          return {
            response: { kind: "completion", evidence: "done" },
            telemetry: {
              endpoint: "https://openrouter.ai/api/v1/chat/completions",
              durationMs: 10,
              success: true
            }
          };
        }
      }
    });

    const event: WorkEvent = {
      id: "event-1",
      timestamp: new Date("2026-03-18T00:00:00.000Z"),
      sessionId: "session-1",
      goalId: "goal-1",
      type: "session.started",
      sourceLayer: "surface",
      payload: {
        goalDescription: "demo"
      }
    };

    app.eventBus.emit(event);
    await app.flushTraces();

    const trace = await readFile(join(workspaceRoot, ".octopus", "traces", "session-1.jsonl"), "utf8");
    expect(trace).toContain('"type":"session.started"');
  });

  it("emits policy selection and resolution events during app bootstrap", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-policy-"));
    tempDirs.push(workspaceRoot);

    const app = await createLocalWorkEngine({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus"),
      runtime: {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      profile: "vibe",
      modelClient: {
        async completeTurn() {
          return {
            response: { kind: "completion", evidence: "done" },
            telemetry: {
              endpoint: "https://openrouter.ai/api/v1/chat/completions",
              durationMs: 10,
              success: true
            }
          };
        }
      }
    });

    await app.flushTraces();

    const trace = await readFile(join(workspaceRoot, ".octopus", "traces", "system-policy.jsonl"), "utf8");
    expect(trace).toContain('"type":"profile.selected"');
    expect(trace).toContain('"type":"policy.resolved"');
    expect(trace).toContain('"profile":"vibe"');
  });

  it("wires MCP extensions and passes allowed tools into runtime context when configured", async () => {
    const capturedContexts: Array<{ mcpTools?: Array<{ serverId: string; name: string }> }> = [];
    const handler: ActionHandler = vi.fn(async () => ({
      success: true,
      output: "mcp result"
    }));
    const startAll = vi.fn(async () => {});
    const stopAll = vi.fn(async () => {});
    const manager = {
      startAll,
      stopAll,
      getAllTools() {
        return [
          {
            serverId: "filesystem",
            name: "read_file",
            description: "Read a file",
            inputSchema: { type: "object" },
            policy: { allowed: true }
          }
        ];
      }
    };
    const createMcpActionHandler = vi.fn(() => handler);
    const app = await createLocalWorkEngine(
      {
        workspaceRoot: process.cwd(),
        dataDir: `${process.cwd()}/.octopus`,
        runtime: {
          provider: "openai-compatible",
          model: "gpt-4o",
          apiKey: "test-key",
          maxTokens: 1_024,
          temperature: 0,
          allowModelApiCall: true
        },
        mcp: {
          servers: [
            {
              id: "filesystem",
              transport: "stdio",
              command: "noop"
            }
          ]
        },
        modelClient: {
          async completeTurn(input) {
            capturedContexts.push({
              mcpTools: input.context?.mcpTools?.map((tool) => ({
                serverId: tool.serverId,
                name: tool.name
              }))
            });
            return {
              response: { kind: "completion", evidence: "done" },
              telemetry: {
                endpoint: "https://openrouter.ai/api/v1/chat/completions",
                durationMs: 10,
                success: true
              }
            };
          }
        }
      },
      {
        createMcpSecurityClassifier: () => ({
          classifyTool() {
            return { allowed: true, securityCategory: "network" };
          }
        }),
        createMcpServerManager: () => manager as never,
        createMcpActionHandler
      }
    );

    const substrateResult = await app.substrate.execute(
      {
        id: "action-mcp",
        type: "mcp-call",
        params: {
          serverId: "filesystem",
          toolName: "read_file",
          arguments: { path: "README.md" }
        },
        createdAt: new Date()
      },
      {
        workspaceRoot: process.cwd(),
        sessionId: "session-1",
        goalId: "goal-1",
        eventBus: app.eventBus
      }
    );
    await app.engine.executeGoal(
      {
        id: "goal-1",
        description: "Use MCP",
        constraints: [],
        successCriteria: [],
        createdAt: new Date()
      },
      {
        workspaceRoot: process.cwd()
      }
    );

    expect(startAll).toHaveBeenCalledTimes(1);
    expect(createMcpActionHandler).toHaveBeenCalledTimes(1);
    expect(substrateResult).toEqual({
      success: true,
      output: "mcp result"
    });
    expect(capturedContexts).toContainEqual({
      mcpTools: [
        {
          serverId: "filesystem",
          name: "read_file"
        }
      ]
    });

    await app.flushTraces();
    expect(stopAll).toHaveBeenCalledTimes(1);
  });
});
