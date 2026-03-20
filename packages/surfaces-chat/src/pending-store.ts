import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { PendingNotification } from "./types.js";

export class PendingStore {
  private mutationQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async save(pending: PendingNotification): Promise<void> {
    await this.runExclusive(async () => {
      const entries = await this.loadAll();
      entries.push(pending);
      await this.write(entries);
    });
  }

  async remove(sessionId: string): Promise<void> {
    await this.runExclusive(async () => {
      const entries = await this.loadAll();
      await this.write(entries.filter((entry) => entry.sessionId !== sessionId));
    });
  }

  async loadAll(): Promise<PendingNotification[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const raw = (await readFile(this.filePath, "utf8")).trim();
    if (raw.length === 0) {
      return [];
    }

    const payload = JSON.parse(raw) as unknown;
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload.filter(isPendingNotification);
  }

  private async write(entries: PendingNotification[]): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.pending-${randomUUID()}.tmp`);
    await writeFile(tmpPath, JSON.stringify(entries, null, 2), "utf8");
    await rename(tmpPath, this.filePath);
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function isPendingNotification(value: unknown): value is PendingNotification {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" &&
    typeof record.callbackUrl === "string" &&
    typeof record.channelId === "string" &&
    typeof record.goalDescription === "string" &&
    typeof record.submittedAt === "string"
  );
}
