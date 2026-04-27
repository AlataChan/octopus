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

export type SkillId = "dev" | "ops" | "content" | "law" | "finance" | "molt";

export type ActionTerminalOutcome =
  | "completed"
  | "failed"
  | "denied"
  | "timed_out"
  | "cancelled"
  | "interrupted";

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
  outcome?: ActionTerminalOutcome;
  durationMs?: number;
  timedOut?: boolean;
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

export type RiskLevel = "safe" | "consequential" | "dangerous";

export type BlockedKind =
  | "clarification-required"
  | "approval-required"
  | "verification-failed"
  | "paused-by-operator"
  | "budget-exceeded"
  | "system-error";

export interface ApprovalFingerprint {
  actionId: string;
  actionType: ActionType;
  fingerprint: string;
}

export interface BlockedReason {
  kind: BlockedKind;
  question?: string;
  approval?: ApprovalFingerprint;
  riskLevel?: RiskLevel;
  evidence?: string;
  verificationDetails?: EvidenceItem[];
}

export interface SessionUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  wallClockMs: number;
  turnCount: number;
}

export interface BudgetLimits {
  maxTokens?: number;
  maxCostUsd?: number;
  maxWallClockMs?: number;
}

export interface WorkSession {
  id: string;
  goalId: string;
  workspaceId: string;
  configProfileId: string;
  createdBy?: string;
  taskTitle?: string;
  namedGoalId?: string;
  goalSummary?: string;
  skillContext?: SkillId;
  injectionPlanIds?: string[];
  kbVaultPath?: string;
  state: SessionState;
  items: WorkItem[];
  observations: Observation[];
  artifacts: Artifact[];
  transitions: StateTransition[];
  createdAt: Date;
  updatedAt: Date;
  usage?: SessionUsage;
  blockedReason?: BlockedReason;
}

export interface SessionSummary {
  id: string;
  goalId: string;
  workspaceId: string;
  configProfileId: string;
  createdBy?: string;
  taskTitle?: string;
  namedGoalId?: string;
  goalSummary?: string;
  skillContext?: SkillId;
  injectionPlanIds?: string[];
  kbVaultPath?: string;
  state: SessionState;
  updatedAt: Date;
}
