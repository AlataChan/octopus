import { afterEach, describe, expect, it, vi } from "vitest";

import { WatcherSource, type WatcherLike } from "../../sources/watcher.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("WatcherSource", () => {
  it("debounces file events before emitting an automation event", async () => {
    vi.useFakeTimers();

    const watcher = new FakeWatcher();
    const source = new WatcherSource(
      {
        type: "watcher",
        namedGoalId: "normalize-incoming",
        watchPath: "./incoming",
        events: ["add"],
        debounceMs: 100
      },
      () => watcher
    );

    const events: Array<Record<string, unknown> | undefined> = [];
    await source.start((event) => {
      events.push(event.payload);
    });

    watcher.emit("add", "incoming/a.txt");
    watcher.emit("add", "incoming/b.txt");
    await vi.advanceTimersByTimeAsync(100);

    expect(events).toEqual([{ event: "add", path: "incoming/b.txt" }]);

    await source.stop();
    expect(watcher.closed).toBe(true);
  });
});

class FakeWatcher implements WatcherLike {
  private readonly listeners = new Map<string, Array<(path: string) => void>>();
  closed = false;

  on(event: "add" | "change" | "unlink", listener: (path: string) => void): this {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
    return this;
  }

  emit(event: "add" | "change" | "unlink", path: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(path);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
