import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ReleaseReason = "completed" | "failed" | "cancelled" | "stale-cleared";

export interface WorkspaceLock {
  acquire(workspaceRoot: string, sessionId: string): Promise<void>;
  release(workspaceRoot: string, sessionId: string, reason: ReleaseReason): Promise<void>;
  isHeld(workspaceRoot: string): Promise<boolean>;
  clearStale(workspaceRoot: string): Promise<boolean>;
}

interface StoredWorkspaceLock {
  sessionId: string;
  pid: number;
  acquiredAt: string;
}

export interface FileWorkspaceLockOptions {
  currentPid?: () => number;
  isPidActive?: (pid: number) => boolean;
}

export class FileWorkspaceLock implements WorkspaceLock {
  private readonly currentPid: () => number;
  private readonly isPidActive: (pid: number) => boolean;

  constructor(options: FileWorkspaceLockOptions = {}) {
    this.currentPid = options.currentPid ?? (() => process.pid);
    this.isPidActive = options.isPidActive ?? defaultIsPidActive;
  }

  async acquire(workspaceRoot: string, sessionId: string): Promise<void> {
    const filePath = getLockPath(workspaceRoot);
    await mkdir(join(workspaceRoot, ".octopus"), { recursive: true });

    const current = await this.readLock(workspaceRoot);
    if (current && !(current.sessionId === sessionId && current.pid === this.currentPid())) {
      throw new Error(`Workspace is already locked by session ${current.sessionId}`);
    }

    await writeFile(
      filePath,
      JSON.stringify(
        {
          sessionId,
          pid: this.currentPid(),
          acquiredAt: new Date().toISOString()
        } satisfies StoredWorkspaceLock
      ),
      "utf8"
    );
  }

  async release(workspaceRoot: string, _sessionId: string, _reason: ReleaseReason): Promise<void> {
    await rm(getLockPath(workspaceRoot), { force: true });
  }

  async isHeld(workspaceRoot: string): Promise<boolean> {
    return (await this.readLock(workspaceRoot)) !== null;
  }

  async clearStale(workspaceRoot: string): Promise<boolean> {
    const current = await this.readLock(workspaceRoot);
    if (!current) {
      return false;
    }

    if (this.isPidActive(current.pid)) {
      return false;
    }

    await rm(getLockPath(workspaceRoot), { force: true });
    return true;
  }

  private async readLock(workspaceRoot: string): Promise<StoredWorkspaceLock | null> {
    try {
      const raw = await readFile(getLockPath(workspaceRoot), "utf8");
      return JSON.parse(raw) as StoredWorkspaceLock;
    } catch {
      return null;
    }
  }
}

function getLockPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".octopus", "workspace.lock");
}

function defaultIsPidActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
