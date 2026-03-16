import type { Artifact, SessionSummary, WorkSession } from "@octopus/work-contracts";

export interface StateStore {
  saveSession(session: WorkSession): Promise<void>;
  loadSession(sessionId: string): Promise<WorkSession | null>;
  listSessions(): Promise<SessionSummary[]>;
  saveArtifact(sessionId: string, artifact: Artifact): Promise<void>;
  loadArtifacts(sessionId: string): Promise<Artifact[]>;
}

