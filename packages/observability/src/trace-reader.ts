import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { WorkEvent } from "./types.js";

export class TraceReader {
  constructor(private readonly tracesDir: string) {}

  async read(sessionId: string): Promise<WorkEvent[]> {
    const filePath = join(this.tracesDir, `${sessionId}.jsonl`);
    const content = await readFile(filePath, "utf8");

    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => deserializeEvent(line));
  }
}

function deserializeEvent(line: string): WorkEvent {
  const raw = JSON.parse(line) as Omit<WorkEvent, "timestamp"> & { timestamp: string };

  return {
    ...raw,
    timestamp: new Date(raw.timestamp)
  } as WorkEvent;
}
