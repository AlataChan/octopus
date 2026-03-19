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
