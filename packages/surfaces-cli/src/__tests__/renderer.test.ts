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
          provider: "openai-compatible",
          model: "gpt-4o",
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          durationMs: 20,
          success: true
        }
      }
    ];

    expect(renderReplay(events)).toContain("file.read README.md");
    expect(renderReplay(events)).toContain("model.call openai-compatible/gpt-4o");
  });
});
