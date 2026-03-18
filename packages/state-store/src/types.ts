import type { SessionSnapshot } from "@octopus/agent-runtime";
import type { Artifact, SessionSummary, WorkSession } from "@octopus/work-contracts";

export interface SnapshotSummary {
  snapshotId: string;
  capturedAt: Date;
  schemaVersion: number;
}

export interface StateStore {
  saveSession(session: WorkSession): Promise<void>;
  loadSession(sessionId: string): Promise<WorkSession | null>;
  listSessions(): Promise<SessionSummary[]>;
  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void>;
  loadSnapshot(sessionId: string, snapshotId?: string): Promise<SessionSnapshot | null>;
  listSnapshots(sessionId: string): Promise<SnapshotSummary[]>;
  saveArtifact(sessionId: string, artifact: Artifact): Promise<void>;
  loadArtifacts(sessionId: string): Promise<Artifact[]>;
}
