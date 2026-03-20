import type { WorkSession } from "@octopus/work-contracts";

export interface WorkspaceFixture {
  files: Record<string, string>;
}

export type EvalAssertion =
  | { type: "file-exists"; path: string }
  | { type: "file-contains"; path: string; pattern: string }
  | { type: "file-matches"; path: string; expected: string }
  | { type: "shell-passes"; command: string; args?: string[] }
  | { type: "session-completed" }
  | { type: "no-blocked" }
  | { type: "artifact-count"; min: number };

export interface EvalCaseGoal {
  description: string;
  namedGoalId?: string;
  constraints?: string[];
  successCriteria?: string[];
}

export interface EvalCase {
  id: string;
  description: string;
  goal: EvalCaseGoal;
  fixture?: WorkspaceFixture;
  assertions: EvalAssertion[];
  profile?: string;
}

export interface AssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  detail: string;
}

export interface EvalResult {
  caseId: string;
  description: string;
  passed: boolean;
  assertions: AssertionResult[];
  sessionId: string;
  durationMs: number;
  error?: string;
}

export interface EvalReport {
  id: string;
  suite: string;
  startedAt: string;
  completedAt: string;
  results: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  };
}

export interface EvalRunnerDeps {
  createApp: (config: {
    workspaceRoot: string;
    profile: string;
  }) => Promise<{
    engine: {
      executeGoal(
        goal: { id: string; description: string; constraints: string[]; successCriteria: string[]; createdAt: Date; namedGoalId?: string },
        options: { workspaceRoot: string; maxIterations?: number }
      ): Promise<WorkSession>;
    };
    flushTraces: () => Promise<void>;
  }>;
}
