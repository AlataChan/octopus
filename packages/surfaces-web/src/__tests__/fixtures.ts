import type { WorkEvent } from "@octopus/observability";
import { createWorkGoal, createWorkSession, type SessionSummary, type WorkSession } from "@octopus/work-contracts";

import type { ApprovalRequest, StatusResponse } from "../api/client.js";

const now = new Date("2026-03-19T15:42:36.000Z");

export function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? "session-1",
    goalId: overrides.goalId ?? "goal-1",
    state: overrides.state ?? "active",
    updatedAt: overrides.updatedAt ?? now,
    namedGoalId: overrides.namedGoalId,
    goalSummary: overrides.goalSummary
  };
}

export function makeWorkSession(overrides: Partial<WorkSession> = {}): WorkSession {
  const goal = createWorkGoal({
    id: overrides.goalId ?? "goal-1",
    description: "Use MCP",
    createdAt: now
  });
  const session = createWorkSession(goal, {
    id: overrides.id ?? "session-1",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  });

  return {
    ...session,
    state: overrides.state ?? "blocked",
    items: overrides.items ?? [],
    observations: overrides.observations ?? [],
    artifacts: overrides.artifacts ?? [],
    transitions: overrides.transitions ?? [],
    namedGoalId: overrides.namedGoalId,
    goalSummary: overrides.goalSummary ?? session.goalSummary,
    blockedReason: overrides.blockedReason
  };
}

export function makeStatus(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    profile: overrides.profile ?? "vibe",
    apiKeyConfigured: overrides.apiKeyConfigured ?? true,
    tlsEnabled: overrides.tlsEnabled ?? false,
    trustProxyCIDRs: overrides.trustProxyCIDRs ?? [],
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? 4321,
    allowRemote: overrides.allowRemote ?? true,
    activeSessionCount: overrides.activeSessionCount ?? 2,
    connectedClients: overrides.connectedClients ?? 1
  };
}

export function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    promptId: overrides.promptId ?? "prompt-1",
    description: overrides.description ?? "Approve shell command execution",
    riskLevel: overrides.riskLevel ?? "high"
  };
}

export function makeEvent(overrides: Partial<WorkEvent> = {}): WorkEvent {
  return {
    id: overrides.id ?? "evt-1",
    sessionId: overrides.sessionId ?? "session-1",
    goalId: overrides.goalId ?? "goal-1",
    type: overrides.type ?? "session.blocked",
    sourceLayer: overrides.sourceLayer ?? "gateway",
    timestamp: overrides.timestamp ?? now,
    payload: overrides.payload ?? { reason: "Awaiting approval" }
  } as WorkEvent;
}
