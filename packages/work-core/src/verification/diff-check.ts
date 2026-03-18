import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { VerificationResult } from "@octopus/work-contracts";

import type { VerificationContext, VerificationPlugin } from "./plugin.js";
import { resolveWorkspacePath } from "./path.js";

export interface DiffCheckPluginOptions {
  baseline: Record<string, string | undefined>;
  readFile?: (path: string) => Promise<string>;
}

export class DiffCheckPlugin implements VerificationPlugin {
  readonly method = "diff-check" as const;
  private readonly readFileImpl: (path: string) => Promise<string>;

  constructor(private readonly options: DiffCheckPluginOptions) {
    this.readFileImpl = options.readFile ?? ((path) => readFile(path, "utf8"));
  }

  async run(context: VerificationContext): Promise<VerificationResult> {
    const changedPaths: string[] = [];

    for (const artifactPath of context.artifactPaths) {
      const current = await this.readFileImpl(resolveWorkspacePath(context.workspaceRoot, artifactPath));
      if (current !== this.options.baseline[artifactPath]) {
        changedPaths.push(artifactPath);
      }
    }

    const passed = changedPaths.length > 0;
    return {
      id: randomUUID(),
      method: this.method,
      status: passed ? "pass" : "fail",
      evidence: [
        {
          label: "changedPaths",
          value: passed ? changedPaths.join(", ") : "no differences detected",
          passed
        }
      ],
      durationMs: 0,
      createdAt: new Date()
    };
  }
}
