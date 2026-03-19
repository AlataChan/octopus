import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { PendingNotification } from "./types.js";

export class PendingStore {
  constructor(private readonly filePath: string) {}

  save(pending: PendingNotification): void {
    const entries = this.loadAll();
    entries.push(pending);
    this.write(entries);
  }

  remove(sessionId: string): void {
    this.write(this.loadAll().filter((entry) => entry.sessionId !== sessionId));
  }

  loadAll(): PendingNotification[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const raw = readFileSync(this.filePath, "utf8").trim();
    if (raw.length === 0) {
      return [];
    }

    const payload = JSON.parse(raw) as unknown;
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload.filter(isPendingNotification);
  }

  private write(entries: PendingNotification[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(entries, null, 2), "utf8");
  }
}

function isPendingNotification(value: unknown): value is PendingNotification {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" &&
    typeof record.responseUrl === "string" &&
    typeof record.channelId === "string" &&
    typeof record.goalDescription === "string" &&
    typeof record.submittedAt === "string"
  );
}
