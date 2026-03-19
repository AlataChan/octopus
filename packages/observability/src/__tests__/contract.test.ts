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

  it("types all phase 3 gateway and remote payloads without an escape hatch", () => {
    const events: WorkEvent[] = [
      {
        id: "evt-gateway-started",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "gateway.started",
        sourceLayer: "gateway",
        payload: {
          port: 4321,
          host: "127.0.0.1",
          tlsEnabled: false
        }
      },
      {
        id: "evt-gateway-stopped",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "gateway.stopped",
        sourceLayer: "gateway",
        payload: {
          reason: "shutdown"
        }
      },
      {
        id: "evt-client-connected",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "gateway.client.connected",
        sourceLayer: "gateway",
        payload: {
          clientId: "client-1",
          authMethod: "session-token"
        }
      },
      {
        id: "evt-client-disconnected",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "gateway.client.disconnected",
        sourceLayer: "gateway",
        payload: {
          clientId: "client-1",
          reason: "socket-closed"
        }
      },
      {
        id: "evt-auth-failed",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "gateway.auth.failed",
        sourceLayer: "gateway",
        payload: {
          clientId: "client-2",
          method: "token",
          reason: "expired"
        }
      },
      {
        id: "evt-remote-attached",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "remote.session.attached",
        sourceLayer: "gateway",
        payload: {
          clientId: "client-1",
          sessionId: "session-1",
          mode: "control"
        }
      },
      {
        id: "evt-remote-detached",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "remote.session.detached",
        sourceLayer: "gateway",
        payload: {
          clientId: "client-1",
          sessionId: "session-1",
          reason: "client-exit"
        }
      },
      {
        id: "evt-goal-submitted",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "remote.goal.submitted",
        sourceLayer: "gateway",
        payload: {
          clientId: "client-1",
          goalId: "goal-1",
          description: "Generate report"
        }
      },
      {
        id: "evt-approval-requested",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "remote.approval.requested",
        sourceLayer: "gateway",
        payload: {
          sessionId: "session-1",
          promptId: "prompt-1",
          description: "Run npm publish",
          riskLevel: "high"
        }
      },
      {
        id: "evt-approval-resolved",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "remote.approval.resolved",
        sourceLayer: "gateway",
        payload: {
          sessionId: "session-1",
          promptId: "prompt-1",
          action: "approve",
          clientId: "client-1"
        }
      }
    ];

    expect(events).toHaveLength(10);
  });

  it("types all phase 4 MCP and chat payloads without an escape hatch", () => {
    const events: WorkEvent[] = [
      {
        id: "evt-mcp-connected",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "mcp.server.connected",
        sourceLayer: "mcp",
        payload: {
          serverId: "filesystem",
          transport: "stdio",
          toolCount: 4
        }
      },
      {
        id: "evt-mcp-disconnected",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "mcp.server.disconnected",
        sourceLayer: "mcp",
        payload: {
          serverId: "filesystem",
          reason: "shutdown"
        }
      },
      {
        id: "evt-mcp-called",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "mcp.tool.called",
        sourceLayer: "mcp",
        payload: {
          serverId: "filesystem",
          toolName: "read_file",
          sessionId: "session-1"
        }
      },
      {
        id: "evt-mcp-completed",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "mcp.tool.completed",
        sourceLayer: "mcp",
        payload: {
          serverId: "filesystem",
          toolName: "read_file",
          durationMs: 18,
          success: true
        }
      },
      {
        id: "evt-mcp-failed",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "mcp.tool.failed",
        sourceLayer: "mcp",
        payload: {
          serverId: "filesystem",
          toolName: "read_file",
          error: "permission denied"
        }
      },
      {
        id: "evt-chat-goal",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "chat.goal.received",
        sourceLayer: "chat",
        payload: {
          platform: "slack",
          channelId: "C123",
          userId: "U123",
          goalDescription: "clean up temp files"
        }
      },
      {
        id: "evt-chat-sent",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "chat.notification.sent",
        sourceLayer: "chat",
        payload: {
          platform: "slack",
          channelId: "C123",
          sessionId: "session-1",
          notificationType: "completion"
        }
      },
      {
        id: "evt-chat-failed",
        timestamp: new Date(),
        sessionId: "session-1",
        goalId: "goal-1",
        type: "chat.notification.failed",
        sourceLayer: "chat",
        payload: {
          platform: "slack",
          channelId: "C123",
          sessionId: "session-1",
          error: "response_url expired"
        }
      }
    ];

    expect(events).toHaveLength(8);
  });
});
