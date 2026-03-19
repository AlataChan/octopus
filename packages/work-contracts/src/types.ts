export type SessionState =
  | "created"
  | "scoped"
  | "active"
  | "blocked"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkItemState = "pending" | "active" | "done" | "skipped" | "failed";

export type ArtifactType =
  | "code"
  | "script"
  | "report"
  | "dataset"
  | "patch"
  | "document"
  | "runbook"
  | "other";

export type ActionType = "read" | "patch" | "shell" | "search" | "model-call" | "mcp-call";

export interface WorkGoal {
  id: string;
  description: string;
  constraints: string[];
  successCriteria: string[];
  createdAt: Date;
  namedGoalId?: string;
}

export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Action {
  id: string;
  type: ActionType;
  params: Record<string, unknown>;
  result?: ActionResult;
  createdAt: Date;
}

export interface Observation {
  id: string;
  content: string;
  source: string;
  createdAt: Date;
}

export interface Verification {
  id: string;
  method: string;
  passed: boolean;
  evidence: string;
  createdAt: Date;
}

export type VerificationStatus = "pass" | "fail" | "partial" | "skipped";

export type VerificationMethod =
  | "test-runner"
  | "diff-check"
  | "schema-validator"
  | "output-compare"
  | "manual";

export interface EvidenceItem {
  label: string;
  value: string;
  passed: boolean;
}

export interface VerificationResult {
  id: string;
  method: VerificationMethod;
  status: VerificationStatus;
  score?: number;
  evidence: EvidenceItem[];
  durationMs: number;
  createdAt: Date;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  path: string;
  description: string;
  createdAt: Date;
}

export interface Decision {
  id: string;
  type: "continue" | "stop" | "escalate" | "rescope";
  reason: string;
  createdAt: Date;
}

export interface StateTransition {
  from: SessionState;
  to: SessionState;
  reason: string;
  triggerEvent: string;
  artifactRefs?: string[];
  timestamp: Date;
}

export interface WorkItem {
  id: string;
  sessionId: string;
  description: string;
  state: WorkItemState;
  observations: Observation[];
  actions: Action[];
  verifications: Verification[];
  createdAt: Date;
}

export interface WorkSession {
  id: string;
  goalId: string;
  namedGoalId?: string;
  state: SessionState;
  items: WorkItem[];
  observations: Observation[];
  artifacts: Artifact[];
  transitions: StateTransition[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionSummary {
  id: string;
  goalId: string;
  namedGoalId?: string;
  state: SessionState;
  updatedAt: Date;
}
