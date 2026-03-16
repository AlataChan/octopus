import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Artifact, SessionSummary, WorkItem, WorkSession } from "@octopus/work-contracts";

import type { StateStore } from "./types.js";

interface StoredSession extends Omit<WorkSession, "items" | "createdAt" | "updatedAt"> {
  createdAt: string;
  updatedAt: string;
}

interface StoredWorkItem extends Omit<WorkItem, "createdAt"> {
  createdAt: string;
}

interface StoredArtifact extends Omit<Artifact, "createdAt"> {
  createdAt: string;
}

export class FileStateStore implements StateStore {
  constructor(private readonly dataDir: string) {}

  async saveSession(session: WorkSession): Promise<void> {
    const sessionDir = this.getSessionDir(session.id);
    await mkdir(sessionDir, { recursive: true });

    const { items, ...sessionWithoutItems } = session;

    await Promise.all([
      writeFile(join(sessionDir, "session.json"), JSON.stringify(serializeSession(sessionWithoutItems), null, 2)),
      writeFile(join(sessionDir, "items.json"), JSON.stringify(items.map(serializeItem), null, 2))
    ]);
  }

  async loadSession(sessionId: string): Promise<WorkSession | null> {
    const sessionDir = this.getSessionDir(sessionId);

    try {
      const [rawSession, rawItems] = await Promise.all([
        readFile(join(sessionDir, "session.json"), "utf8"),
        readFile(join(sessionDir, "items.json"), "utf8")
      ]);

      return hydrateSession(
        JSON.parse(rawSession) as StoredSession,
        JSON.parse(rawItems) as StoredWorkItem[]
      );
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

            return {
              id: session.id,
              goalId: session.goalId,
              state: session.state,
              updatedAt: session.updatedAt
            } satisfies SessionSummary;
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

  private getSessionsRoot(): string {
    return join(this.dataDir, "sessions");
  }

  private getSessionDir(sessionId: string): string {
    return join(this.getSessionsRoot(), sessionId);
  }
}

function serializeSession(session: Omit<WorkSession, "items">): StoredSession {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
  };
}

function hydrateSession(session: StoredSession, items: StoredWorkItem[]): WorkSession {
  return {
    ...session,
    items: items.map(hydrateItem),
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt)
  };
}

function serializeItem(item: WorkItem): StoredWorkItem {
  return {
    ...item,
    createdAt: item.createdAt.toISOString()
  };
}

function hydrateItem(item: StoredWorkItem): WorkItem {
  return {
    ...item,
    createdAt: new Date(item.createdAt)
  };
}

function serializeArtifact(artifact: Artifact): StoredArtifact {
  return {
    ...artifact,
    createdAt: artifact.createdAt.toISOString()
  };
}

function hydrateArtifact(artifact: StoredArtifact): Artifact {
  return {
    ...artifact,
    createdAt: new Date(artifact.createdAt)
  };
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

