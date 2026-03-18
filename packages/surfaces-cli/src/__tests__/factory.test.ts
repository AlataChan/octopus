import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkEvent } from "@octopus/observability";

import { createLocalWorkEngine } from "../factory.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createLocalWorkEngine", () => {
  it("wires the phase 1 local engine from concrete adapters", () => {
    const app = createLocalWorkEngine({
      workspaceRoot: process.cwd(),
      dataDir: `${process.cwd()}/.octopus`,
      runtime: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
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
              endpoint: "https://api.anthropic.com/v1/messages",
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

    const app = createLocalWorkEngine({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus"),
      runtime: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
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
              endpoint: "https://api.anthropic.com/v1/messages",
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

    const app = createLocalWorkEngine({
      workspaceRoot,
      dataDir: join(workspaceRoot, ".octopus"),
      runtime: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
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
              endpoint: "https://api.anthropic.com/v1/messages",
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
});
