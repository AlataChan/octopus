import { describe, expect, it } from "vitest";

import type { WorkEvent } from "@octopus/observability";

import { renderReplay } from "../renderer.js";

describe("renderReplay", () => {
  it("formats typed substrate events into readable lines", () => {
    const events: WorkEvent[] = [
      {
        id: "evt-1",
        timestamp: new Date("2026-03-16T00:00:00.000Z"),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "file.read",
        sourceLayer: "substrate",
        payload: { path: "README.md", sizeBytes: 10, encoding: "utf8" }
      },
      {
        id: "evt-2",
        timestamp: new Date("2026-03-16T00:00:01.000Z"),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "model.call",
        sourceLayer: "runtime",
        payload: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          endpoint: "https://api.anthropic.com/v1/messages",
          durationMs: 20,
          success: true
        }
      }
    ];

    expect(renderReplay(events)).toContain("file.read README.md");
    expect(renderReplay(events)).toContain("model.call anthropic/claude-sonnet-4-6");
  });
});
