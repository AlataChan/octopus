import { describe, expect, it } from "vitest";

import { createCompletionResponse } from "@octopus/agent-runtime";
import { EventBus } from "@octopus/observability";
import { createWorkGoal } from "@octopus/work-contracts";

import { EmbeddedRuntime } from "../runtime.js";

describe("EmbeddedRuntime snapshots", () => {
  it("captures full runtime snapshot state for an active session", async () => {
    const runtime = new EmbeddedRuntime(
      {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      {
        async completeTurn() {
          return {
            response: createCompletionResponse("done"),
            telemetry: {
              endpoint: "https://openrouter.ai/api/v1/chat/completions",
              durationMs: 1,
              success: true
            }
          };
        }
      },
      new EventBus()
    );

    const session = await runtime.initSession(createWorkGoal({ description: "Snapshot active runtime" }));
    await runtime.loadContext(session.id, {
      workspaceSummary: "repo root",
      visibleFiles: ["README.md"]
    });
    await runtime.ingestToolResult(session.id, "action-1", { success: true, output: "README loaded" });

    const snapshot = await runtime.snapshotSession(session.id);

    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      session: {
        id: session.id
      },
      runtimeContext: {
        pendingResults: [{ success: true, output: "README loaded" }],
        contextPayload: {
          workspaceSummary: "repo root",
          visibleFiles: ["README.md"]
        }
      }
    });
    expect(snapshot.snapshotId).toBeTypeOf("string");
    expect(snapshot.capturedAt).toBeInstanceOf(Date);
  });

  it("hydrates runtime state so later model turns see restored context and results", async () => {
    const runtime = new EmbeddedRuntime(
      {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      {
        async completeTurn(input) {
          expect(input.context).toMatchObject({
            workspaceSummary: "restored workspace"
          });
          expect(input.results).toEqual([{ success: true, output: "restored result" }]);
          return {
            response: createCompletionResponse("restored"),
            telemetry: {
              endpoint: "https://openrouter.ai/api/v1/chat/completions",
              durationMs: 1,
              success: true
            }
          };
        }
      },
      new EventBus()
    );

    const restored = await runtime.hydrateSession({
      schemaVersion: 2,
      snapshotId: "snapshot-1",
      capturedAt: new Date("2026-03-17T00:00:00.000Z"),
      session: {
        id: "session-1",
        goalId: "goal-1",
        workspaceId: "default",
        configProfileId: "default",
        namedGoalId: "daily-report",
        state: "blocked",
        items: [],
        observations: [],
        artifacts: [],
        transitions: [],
        createdAt: new Date("2026-03-17T00:00:00.000Z"),
        updatedAt: new Date("2026-03-17T00:00:00.000Z")
      },
      runtimeContext: {
        pendingResults: [{ success: true, output: "restored result" }],
        contextPayload: {
          workspaceSummary: "restored workspace"
        }
      }
    });

    expect(restored.id).toBe("session-1");
    const response = await runtime.requestNextAction("session-1");
    expect(response.kind).toBe("completion");
  });

  it("hydrates legacy v1 snapshots by defaulting missing runtime context", async () => {
    const runtime = new EmbeddedRuntime(
      {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      {
        async completeTurn(input) {
          expect(input.context).toBeUndefined();
          expect(input.results).toEqual([]);
          return {
            response: createCompletionResponse("restored"),
            telemetry: {
              endpoint: "https://openrouter.ai/api/v1/chat/completions",
              durationMs: 1,
              success: true
            }
          };
        }
      },
      new EventBus()
    );

    const restored = await runtime.hydrateSession({
      schemaVersion: 1,
      snapshotId: "legacy-snapshot-1",
      capturedAt: new Date("2026-03-17T00:00:00.000Z"),
      session: {
        id: "session-legacy",
        goalId: "goal-legacy",
        workspaceId: "default",
        configProfileId: "default",
        state: "blocked",
        items: [],
        observations: [],
        artifacts: [],
        transitions: [],
        createdAt: new Date("2026-03-17T00:00:00.000Z"),
        updatedAt: new Date("2026-03-17T00:00:00.000Z")
      }
    } as never);

    expect(restored.id).toBe("session-legacy");
    const response = await runtime.requestNextAction("session-legacy");
    expect(response.kind).toBe("completion");
  });
});
