import type { SubstrateEventType, WorkEvent } from "./types.js";

export const REQUIRED_TRACE_EVENT_TYPES: readonly SubstrateEventType[] = [
  "file.read",
  "file.patched",
  "command.executed",
  "model.call"
] as const;

export function assertTraceContract(events: WorkEvent[]): void {
  const seenTypes = new Set(events.map((event) => event.type));
  const missing = REQUIRED_TRACE_EVENT_TYPES.filter((type) => !seenTypes.has(type));

  if (missing.length > 0) {
    throw new Error(`Missing required trace events: ${missing.join(", ")}`);
  }
}

