import { describe, expect, it } from "vitest";

import { EventBus } from "../event-bus.js";
import type { WorkEvent } from "../types.js";

describe("EventBus", () => {
  it("delivers typed events to matching subscribers", () => {
    const bus = new EventBus();
    const received: WorkEvent[] = [];

    bus.on("file.read", (event) => {
      received.push(event);
    });

    const event: WorkEvent = {
      id: "evt-1",
      timestamp: new Date(),
      sessionId: "session-1",
      goalId: "goal-1",
      type: "file.read",
      sourceLayer: "substrate",
      payload: {
        path: "README.md",
        sizeBytes: 128,
        encoding: "utf8"
      }
    };

    bus.emit(event);

    expect(received).toEqual([event]);
  });
});

