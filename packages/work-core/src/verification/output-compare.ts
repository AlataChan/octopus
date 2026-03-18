import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { VerificationResult } from "@octopus/work-contracts";

import type { VerificationContext, VerificationPlugin } from "./plugin.js";
import { resolveWorkspacePath } from "./path.js";

export interface OutputComparePluginOptions {
  targetPath: string;
  expectedOutput: string;
  readFile?: (path: string) => Promise<string>;
}

export class OutputComparePlugin implements VerificationPlugin {
  readonly method = "output-compare" as const;
  private readonly readFileImpl: (path: string) => Promise<string>;

  constructor(private readonly options: OutputComparePluginOptions) {
    this.readFileImpl = options.readFile ?? ((path) => readFile(path, "utf8"));
  }

  async run(context: VerificationContext): Promise<VerificationResult> {
    const output = await this.readFileImpl(resolveWorkspacePath(context.workspaceRoot, this.options.targetPath));
    const passed = output === this.options.expectedOutput;

    return {
      id: randomUUID(),
      method: this.method,
      status: passed ? "pass" : "fail",
      evidence: [
        {
          label: "output",
          value: passed ? "matched expected output" : "output differed from expected fixture",
          passed
        }
      ],
      durationMs: 0,
      createdAt: new Date()
    };
  }
}
