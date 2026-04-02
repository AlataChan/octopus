import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SessionSnapshot } from "@octopus/agent-runtime";
import type { Artifact, SessionSummary, WorkSession } from "@octopus/work-contracts";

import {
  hydrateArtifact,
  hydrateWorkSession,
  serializeArtifact,
  serializeWorkSession,
  type StoredArtifact,
  type StoredWorkItem,
  type StoredWorkSession
} from "./session-serde.js";
import { hydrateSnapshot, serializeSnapshot, toSnapshotSummary } from "./snapshot.js";
import type { StateStore } from "./types.js";

interface StoredLatestSnapshot {
  snapshotId: string;
  capturedAt: string;
  schemaVersion: number;
}

export class FileStateStore implements StateStore {
  constructor(private readonly dataDir: string) {}

  async saveSession(session: WorkSession): Promise<void> {
    const sessionDir = this.getSessionDir(session.id);
    await mkdir(sessionDir, { recursive: true });

    const { items, ...sessionWithoutItems } = serializeWorkSession(session);

    await Promise.all([
      writeFile(join(sessionDir, "session.json"), JSON.stringify(sessionWithoutItems, null, 2)),
      writeFile(join(sessionDir, "items.json"), JSON.stringify(items, null, 2))
    ]);
  }

  async loadSession(sessionId: string): Promise<WorkSession | null> {
    const sessionDir = this.getSessionDir(sessionId);

    try {
      const [rawSession, rawItems] = await Promise.all([
        readFile(join(sessionDir, "session.json"), "utf8"),
        readFile(join(sessionDir, "items.json"), "utf8")
      ]);

      return hydrateWorkSession({
        ...(JSON.parse(rawSession) as Omit<StoredWorkSession, "items">),
        items: JSON.parse(rawItems) as StoredWorkItem[]
      });
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }

      throw error;
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const sessionsRoot = this.getSessionsRoot();

    try {
      const entries = await readdir(sessionsRoot, { withFileTypes: true });
      const sessions = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const session = await this.loadSession(entry.name);
            if (!session) {
              return null;
            }

            const summary: SessionSummary = {
              id: session.id,
              goalId: session.goalId,
              workspaceId: session.workspaceId,
              configProfileId: session.configProfileId,
              state: session.state,
              updatedAt: session.updatedAt
            };
            if (session.createdBy) {
              summary.createdBy = session.createdBy;
            }
            if (session.taskTitle) {
              summary.taskTitle = session.taskTitle;
            }
            if (session.namedGoalId) {
              summary.namedGoalId = session.namedGoalId;
            }
            if (session.goalSummary) {
              summary.goalSummary = session.goalSummary;
            }
            return summary;
          })
      );

      return sessions.filter((session): session is SessionSummary => session !== null);
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }

      throw error;
    }
  }

  async saveArtifact(sessionId: string, artifact: Artifact): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    await mkdir(sessionDir, { recursive: true });

    const artifacts = await this.loadArtifacts(sessionId);
    artifacts.push(artifact);

    await writeFile(
      join(sessionDir, "artifacts.json"),
      JSON.stringify(artifacts.map(serializeArtifact), null, 2)
    );
  }

  async loadArtifacts(sessionId: string): Promise<Artifact[]> {
    try {
      const raw = await readFile(join(this.getSessionDir(sessionId), "artifacts.json"), "utf8");
      return (JSON.parse(raw) as StoredArtifact[]).map(hydrateArtifact);
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }

      throw error;
    }
  }

  async saveSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    const snapshotDir = this.getSnapshotDir(sessionId);
    await mkdir(snapshotDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(snapshotDir, `${snapshot.snapshotId}.json`),
        JSON.stringify(serializeSnapshot(snapshot), null, 2)
      ),
      this.writeLatestSnapshot(sessionId, snapshot)
    ]);
  }

  async loadSnapshot(sessionId: string, snapshotId?: string): Promise<SessionSnapshot | null> {
    const snapshotDir = this.getSnapshotDir(sessionId);

    try {
      const targetId = snapshotId ?? (await this.readLatestSnapshotId(sessionId)) ?? (await this.listSnapshots(sessionId))[0]?.snapshotId;
      if (!targetId) {
        return null;
      }

      const raw = await readFile(join(snapshotDir, `${targetId}.json`), "utf8");
      return hydrateSnapshot(JSON.parse(raw));
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }

      throw error;
    }
  }

  async listSnapshots(sessionId: string): Promise<import("./types.js").SnapshotSummary[]> {
    const snapshotDir = this.getSnapshotDir(sessionId);

    try {
      const files = await readdir(snapshotDir);
      const snapshots = await Promise.all(
        files
          .filter((file) => file.endsWith(".json") && file !== "latest.json")
          .map(async (file) => {
            const raw = await readFile(join(snapshotDir, file), "utf8");
            return toSnapshotSummary(hydrateSnapshot(JSON.parse(raw)));
          })
      );

      return snapshots.sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime());
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }

      throw error;
    }
  }

  private getSessionsRoot(): string {
    return join(this.dataDir, "sessions");
  }

  private getSessionDir(sessionId: string): string {
    return join(this.getSessionsRoot(), sessionId);
  }

  private getSnapshotDir(sessionId: string): string {
    return join(this.dataDir, "snapshots", sessionId);
  }

  private getLatestSnapshotPath(sessionId: string): string {
    return join(this.getSnapshotDir(sessionId), "latest.json");
  }

  private async readLatestSnapshotId(sessionId: string): Promise<string | null> {
    try {
      const raw = await readFile(this.getLatestSnapshotPath(sessionId), "utf8");
      return (JSON.parse(raw) as StoredLatestSnapshot).snapshotId;
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }

      throw error;
    }
  }

  private async writeLatestSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    const nextLatest: StoredLatestSnapshot = {
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt.toISOString(),
      schemaVersion: snapshot.schemaVersion
    };

    try {
      const raw = await readFile(this.getLatestSnapshotPath(sessionId), "utf8");
      const currentLatest = JSON.parse(raw) as StoredLatestSnapshot;
      if (new Date(currentLatest.capturedAt).getTime() > snapshot.capturedAt.getTime()) {
        return;
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }

    await writeFile(this.getLatestSnapshotPath(sessionId), JSON.stringify(nextLatest, null, 2));
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
