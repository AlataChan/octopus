import { createWorkGoal } from "@octopus/work-contracts";
import type { WorkEvent } from "@octopus/observability";

import type { OperatorContext } from "../types.js";
import { HttpError, assertPermission, type RouteDeps } from "./shared.js";

export async function handleListSessions(deps: RouteDeps, operator: OperatorContext) {
  assertPermission(operator, "sessions.list");
  return deps.store.listSessions();
}

export async function handleGetSession(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string
) {
  assertPermission(operator, "sessions.read");
  const session = await deps.store.loadSession(sessionId);
  if (!session) {
    throw new HttpError(404, `Unknown session: ${sessionId}`);
  }
  return session;
}

export async function handleListSnapshots(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string
) {
  assertPermission(operator, "sessions.read");
  return deps.store.listSnapshots(sessionId);
}

export async function handleGetEvents(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string
): Promise<WorkEvent[]> {
  assertPermission(operator, "sessions.read");
  if (!deps.traceReader) {
    return [];
  }

  try {
    return await deps.traceReader.read(sessionId);
  } catch {
    return [];
  }
}

export async function handleRollbackSession(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string,
  body?: unknown
) {
  assertPermission(operator, "sessions.control");

  const session = await deps.store.loadSession(sessionId);
  if (!session) {
    throw new HttpError(404, `Unknown session: ${sessionId}`);
  }

  const requestedSnapshotId = readSnapshotId(body);
  const snapshot = await deps.store.loadSnapshot(sessionId, requestedSnapshotId ?? undefined);
  if (!snapshot) {
    throw new HttpError(
      404,
      requestedSnapshotId
        ? `Unknown snapshot ${requestedSnapshotId} for session ${sessionId}`
        : `No snapshots found for session ${sessionId}`
    );
  }

  const goal = createWorkGoal({
    id: session.goalId,
    namedGoalId: session.namedGoalId,
    description: session.goalSummary ?? `Rollback session ${sessionId}`
  });

  const restoredSession = await deps.engine.executeGoal(goal, {
    workspaceRoot: deps.workspaceRoot,
    workspaceId: session.workspaceId,
    configProfileId: session.configProfileId,
    createdBy: operator.operatorId,
    taskTitle: session.taskTitle,
    resumeFrom: {
      sessionId,
      snapshotId: snapshot.snapshotId
    }
  });

  return {
    sessionId: restoredSession.id,
    state: restoredSession.state,
    restoredFromSessionId: sessionId,
    snapshotId: snapshot.snapshotId
  };
}

function readSnapshotId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const snapshotId = (body as { snapshotId?: unknown }).snapshotId;
  return typeof snapshotId === "string" && snapshotId.trim().length > 0 ? snapshotId.trim() : null;
}
