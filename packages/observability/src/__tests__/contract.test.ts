import { describe, expect, it } from "vitest";

import { REQUIRED_TRACE_EVENT_TYPES, assertTraceContract } from "../contract.js";
import type { WorkEvent } from "../types.js";

describe("observability contract", () => {
  it("passes when all required trace events are present", () => {
    const events = REQUIRED_TRACE_EVENT_TYPES.map((type, index) => ({
      id: `evt-${index}`,
      timestamp: new Date(),
      sessionId: "session-1",
      goalId: "goal-1",
      type,
      sourceLayer: type === "model.call" ? "runtime" : "substrate",
      payload:
        type === "file.read"
          ? { path: "README.md", sizeBytes: 1, encoding: "utf8" }
          : type === "file.patched"
            ? { path: "README.md", operation: "update", bytesWritten: 2 }
            : type === "command.executed"
              ? {
                  executable: "git",
                  args: ["status"],
                  cwd: "/workspace",
                  exitCode: 0,
                  durationMs: 3,
                  timedOut: false
                }
              : {
                  provider: "anthropic",
                  model: "claude-sonnet-4-6",
                  endpoint: "https://api.anthropic.com/v1/messages",
                  inputTokens: 10,
                  outputTokens: 5,
                  durationMs: 18,
                  success: true
                }
    })) as WorkEvent[];

    expect(() => assertTraceContract(events)).not.toThrow();
  });

  it("fails when a required trace event is missing", () => {
    const events: WorkEvent[] = [
      {
        id: "evt-1",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "file.read",
        sourceLayer: "substrate",
        payload: { path: "README.md", sizeBytes: 1, encoding: "utf8" }
      }
    ];

    expect(() => assertTraceContract(events)).toThrow(/file\.patched/);
  });
});
