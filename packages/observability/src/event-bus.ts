import { EventEmitter } from "node:events";

import type { WorkEvent, WorkEventType } from "./types.js";

export class EventBus {
  private readonly emitter = new EventEmitter();

  emit(event: WorkEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  on<T extends WorkEventType>(type: T, handler: (event: Extract<WorkEvent, { type: T }>) => void): () => void {
    this.emitter.on(type, handler);

    return () => {
      this.emitter.off(type, handler);
    };
  }

  onAny(handler: (event: WorkEvent) => void): () => void {
    this.emitter.on("*", handler);

    return () => {
      this.emitter.off("*", handler);
    };
  }
}
