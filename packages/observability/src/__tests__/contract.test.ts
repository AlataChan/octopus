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

  it("types all phase 2 event payloads without an escape hatch", () => {
    const events: WorkEvent[] = [
      {
        id: "evt-snapshot-captured",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "snapshot.captured",
        sourceLayer: "runtime",
        payload: {
          sessionId: "session-1",
          snapshotId: "snapshot-1",
          capturedAt: new Date(),
          schemaVersion: 2
        }
      },
      {
        id: "evt-snapshot-restored",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "snapshot.restored",
        sourceLayer: "runtime",
        payload: {
          sessionId: "session-1",
          snapshotId: "snapshot-1",
          restoredAt: new Date()
        }
      },
      {
        id: "evt-lock-acquired",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "workspace.lock.acquired",
        sourceLayer: "work-core",
        payload: {
          sessionId: "session-1",
          pid: 1234
        }
      },
      {
        id: "evt-lock-released",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "workspace.lock.released",
        sourceLayer: "work-core",
        payload: {
          sessionId: "session-1",
          reason: "completed"
        }
      },
      {
        id: "evt-plugin",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "verification.plugin.run",
        sourceLayer: "work-core",
        payload: {
          method: "test-runner",
          status: "pass",
          score: 1,
          durationMs: 42,
          evidenceCount: 2
        }
      },
      {
        id: "evt-runbook",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "runbook.generated",
        sourceLayer: "work-core",
        payload: {
          sessionId: "session-1",
          path: "RUNBOOK.md",
          stepCount: 3
        }
      },
      {
        id: "evt-profile",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "profile.selected",
        sourceLayer: "surface",
        payload: {
          profile: "vibe",
          source: "builtin"
        }
      },
      {
        id: "evt-policy",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "policy.resolved",
        sourceLayer: "surface",
        payload: {
          profile: "vibe",
          source: "builtin",
          defaultDeny: false
        }
      },
      {
        id: "evt-source-started",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "automation.source.started",
        sourceLayer: "automation",
        payload: {
          sourceType: "cron",
          namedGoalId: "daily-report"
        }
      },
      {
        id: "evt-source-stopped",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "automation.source.stopped",
        sourceLayer: "automation",
        payload: {
          sourceType: "watcher",
          namedGoalId: "normalize-incoming",
          reason: "shutdown"
        }
      },
      {
        id: "evt-source-failed",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "automation.source.failed",
        sourceLayer: "automation",
        payload: {
          sourceType: "cron",
          namedGoalId: "daily-report",
          error: "Unknown namedGoalId"
        }
      },
      {
        id: "evt-triggered",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "automation.triggered",
        sourceLayer: "automation",
        payload: {
          sourceType: "cron",
          namedGoalId: "daily-report",
          payload: { trigger: "schedule" }
        }
      },
      {
        id: "evt-injected",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "event.injected",
        sourceLayer: "automation",
        payload: {
          namedGoalId: "daily-report",
          sessionId: "session-1",
          action: "resumed"
        }
      }
    ];

    expect(events).toHaveLength(13);
  });
});
