import type { SessionSnapshot } from "@octopus/agent-runtime";

import { hydrateWorkSession, serializeWorkSession, type StoredWorkSession } from "./session-serde.js";
import type { SnapshotSummary } from "./types.js";

interface StoredSnapshot extends Omit<SessionSnapshot, "capturedAt" | "session" | "runtimeContext"> {
  capturedAt: string;
  session: StoredWorkSession;
  runtimeContext: {
    pendingResults: SessionSnapshot["runtimeContext"]["pendingResults"];
    contextPayload?: SessionSnapshot["runtimeContext"]["contextPayload"];
  };
}

export function serializeSnapshot(snapshot: SessionSnapshot): StoredSnapshot {
  return {
    ...snapshot,
    capturedAt: snapshot.capturedAt.toISOString(),
    session: serializeWorkSession(snapshot.session),
    runtimeContext: {
      pendingResults: snapshot.runtimeContext.pendingResults,
      contextPayload: snapshot.runtimeContext.contextPayload
    }
  };
}

export function hydrateSnapshot(snapshot: StoredSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    capturedAt: new Date(snapshot.capturedAt),
    session: hydrateWorkSession(snapshot.session),
    runtimeContext: {
      pendingResults: snapshot.runtimeContext.pendingResults,
      contextPayload: snapshot.runtimeContext.contextPayload
    }
  };
}

export function toSnapshotSummary(snapshot: SessionSnapshot): SnapshotSummary {
  return {
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    schemaVersion: snapshot.schemaVersion
  };
}
