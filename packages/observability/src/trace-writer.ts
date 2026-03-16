import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { WorkEvent } from "./types.js";

export class TraceWriter {
  constructor(private readonly tracesDir: string) {}

  async append(event: WorkEvent): Promise<void> {
    const filePath = join(this.tracesDir, `${event.sessionId}.jsonl`);
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

