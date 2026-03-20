import { describe, expect, it } from "vitest";

import { createActionResponse, type ResumeInput } from "@octopus/agent-runtime";
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
        provider: "openai-compatible",
        model: "gpt-4o",
        requestId: "req-1",
        success: true
      });
    });

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
            response: createActionResponse({
              id: "action-1",
              type: "read",
              params: { path: "README.md", encoding: "utf8" },
              createdAt: new Date()
            }),
            telemetry: {
              endpoint: "https://openrouter.ai/api/v1/chat/completions",
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

  it("resumeSession accepts optional ResumeInput without error", async () => {
    const eventBus = new EventBus();

    const runtime = new EmbeddedRuntime(
      {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: false
      },
      {
        async completeTurn() {
          throw new Error("should not be called");
        }
      },
      eventBus
    );

    const session = await runtime.initSession(createWorkGoal({ description: "Resume test" }));

    // resumeSession with no input (operator-initiated)
    await expect(runtime.resumeSession(session.id)).resolves.toBeUndefined();

    // resumeSession with operator input
    const operatorInput: ResumeInput = { kind: "operator" };
    await expect(runtime.resumeSession(session.id, operatorInput)).resolves.toBeUndefined();

    // resumeSession with clarification input
    const clarificationInput: ResumeInput = { kind: "clarification", answer: "Yes" };
    await expect(runtime.resumeSession(session.id, clarificationInput)).resolves.toBeUndefined();

    // resumeSession with approval input
    const approvalInput: ResumeInput = { kind: "approval", decision: "approve" };
    await expect(runtime.resumeSession(session.id, approvalInput)).resolves.toBeUndefined();

    // Session is still accessible after resume
    const metadata = await runtime.getMetadata(session.id);
    expect(metadata.runtimeType).toBe("embedded");
    expect(metadata.model).toBe("gpt-4o");
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
        provider: "openai-compatible",
        model: "gpt-4o",
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
