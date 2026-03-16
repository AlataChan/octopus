import { describe, expect, it } from "vitest";

import { createActionResponse } from "@octopus/agent-runtime";
import { EventBus } from "@octopus/observability";
import { createWorkGoal } from "@octopus/work-contracts";

import { EmbeddedRuntime } from "../runtime.js";

describe("EmbeddedRuntime", () => {
  it("creates sessions and emits model.call when requesting the next action", async () => {
    const eventBus = new EventBus();
    const events: string[] = [];
    eventBus.on("model.call", (event) => {
      events.push(event.type);
      expect(event.payload).toMatchObject({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        requestId: "req-1",
        success: true
      });
    });

    const runtime = new EmbeddedRuntime(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      {
        async completeTurn() {
          return {
            response: createActionResponse({
              id: "action-1",
              type: "read",
              params: { path: "README.md", encoding: "utf8" },
              createdAt: new Date()
            }),
            telemetry: {
              endpoint: "https://api.anthropic.com/v1/messages",
              durationMs: 12,
              inputTokens: 20,
              outputTokens: 10,
              requestId: "req-1",
              success: true
            }
          };
        }
      },
      eventBus
    );

    const session = await runtime.initSession(createWorkGoal({ description: "Read repo docs" }));
    await runtime.loadContext(session.id, { workspaceSummary: "repo root" });
    const response = await runtime.requestNextAction(session.id);

    expect(response.kind).toBe("action");
    expect(events).toEqual(["model.call"]);
  });

  it("falls back to blocked when the model client returns an invalid turn", async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; success: boolean; error?: string }> = [];
    eventBus.on("model.call", (event) => {
      if (event.type === "model.call") {
        events.push({
          type: event.type,
          success: event.payload.success,
          error: event.payload.error
        });
      }
    });

    const runtime = new EmbeddedRuntime(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      {
        async completeTurn() {
          throw new Error("Model returned malformed runtime JSON.");
        }
      },
      eventBus
    );

    const session = await runtime.initSession(createWorkGoal({ description: "Read repo docs" }));
    const response = await runtime.requestNextAction(session.id);

    expect(response).toEqual({
      kind: "blocked",
      reason: "Model returned malformed runtime JSON."
    });
    expect(events).toEqual([
      {
        type: "model.call",
        success: false,
        error: "Model returned malformed runtime JSON."
      }
    ]);
  });
});
