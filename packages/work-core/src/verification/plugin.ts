import type { VerificationMethod, VerificationResult } from "@octopus/work-contracts";

export interface VerificationContext {
  workspaceRoot: string;
  sessionId: string;
  goalId: string;
  workItemId: string;
  artifactPaths: string[];
}

export interface VerificationPlugin {
  method: VerificationMethod;
  run(context: VerificationContext): Promise<VerificationResult>;
}
