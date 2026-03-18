import chokidar, { type FSWatcher } from "chokidar";

import type { AutomationEvent, AutomationSource, WatcherSourceConfig } from "../types.js";

export interface WatcherLike {
  on(event: "add" | "change" | "unlink", listener: (path: string) => void): this;
  close(): Promise<void> | void;
}

export type WatcherFactory = (watchPath: string) => WatcherLike;

export class WatcherSource implements AutomationSource {
  readonly name: string;
  readonly sourceType = "watcher" as const;
  readonly namedGoalId: string;
  private watcher?: WatcherLike;
  private debounceTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: WatcherSourceConfig,
    private readonly watcherFactory: WatcherFactory = (watchPath) => chokidar.watch(watchPath, { ignoreInitial: true }) as FSWatcher
  ) {
    this.name = `watcher:${config.namedGoalId}`;
    this.namedGoalId = config.namedGoalId;
  }

  async start(onEvent: (event: AutomationEvent) => void): Promise<void> {
    this.watcher = this.watcherFactory(this.config.watchPath);

    for (const eventName of this.config.events) {
      this.watcher.on(eventName, (path) => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          onEvent({
            sourceType: "watcher",
            namedGoalId: this.config.namedGoalId,
            triggeredAt: new Date(),
            payload: {
              event: eventName,
              path
            }
          });
        }, this.config.debounceMs ?? 500);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    await this.watcher?.close();
  }
}
