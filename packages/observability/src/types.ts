export type SourceLayer = "work-core" | "runtime" | "substrate" | "automation" | "surface";

export type SessionEventType =
  | "session.started"
  | "session.blocked"
  | "session.completed"
  | "session.failed"
  | "session.cancelled";

export type WorkItemEventType =
  | "workitem.started"
  | "workitem.completed"
  | "workitem.skipped"
  | "workitem.failed";

export type CoreEventType =
  | "context.loaded"
  | "decision.made"
  | "action.requested"
  | "action.completed"
  | "verification.requested"
  | "verification.completed"
  | "artifact.emitted";

export type SubstrateEventType =
  | "file.read"
  | "file.patched"
  | "command.executed"
  | "model.call";

export type SnapshotEventType =
  | "snapshot.captured"
  | "snapshot.restored";

export type WorkspaceLockEventType =
  | "workspace.lock.acquired"
  | "workspace.lock.released";

export type VerificationPluginEventType = "verification.plugin.run";

export type ArtifactManagementEventType = "runbook.generated";

export type PolicyEventType = "profile.selected" | "policy.resolved";

export type AutomationEventType =
  | "automation.source.started"
  | "automation.source.stopped"
  | "automation.source.failed"
  | "automation.triggered"
  | "event.injected";

export type WorkEventType =
  | SessionEventType
  | WorkItemEventType
  | CoreEventType
  | SubstrateEventType
  | SnapshotEventType
  | WorkspaceLockEventType
  | VerificationPluginEventType
  | ArtifactManagementEventType
  | PolicyEventType
  | AutomationEventType;

export interface FileReadPayload {
  path: string;
  sizeBytes: number;
  encoding: string;
}

export interface FilePatchedPayload {
  path: string;
  operation: "create" | "update" | "delete";
  bytesWritten: number;
  diff?: string;
}

export interface CommandExecutedPayload {
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

export interface ModelCallPayload {
  provider: string;
  model: string;
  endpoint: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  success: boolean;
  requestId?: string;
  statusCode?: number;
  error?: string;
}

export interface SessionStartedPayload {
  goalDescription: string;
}

export interface SessionBlockedPayload {
  reason?: string;
  clarification?: string;
  actionId?: string;
  riskLevel?: string;
}

export interface SessionCompletedPayload {
  evidence: string;
}

export interface SessionFailedPayload {
  error: string;
}

export interface SessionCancelledPayload {
  reason?: string;
}

export interface WorkItemLifecyclePayload {
  workItemId?: string;
  description?: string;
  reason?: string;
}

export interface ContextLoadedPayload {
  workspaceSummary?: string;
  visibleFiles?: string[];
}

export interface DecisionMadePayload {
  decision?: string;
  reason: string;
}

export interface ActionRequestedPayload {
  actionId: string;
  actionType: string;
}

export interface ActionCompletedPayload {
  actionId: string;
  success: boolean;
}

export interface VerificationRequestedPayload {
  method: string;
  target?: string;
}

export interface VerificationCompletedPayload {
  method: string;
  passed: boolean;
  evidence?: string;
}

export interface ArtifactEmittedPayload {
  artifactPath: string;
  artifactType?: string;
  description?: string;
}

export interface SnapshotCapturedPayload {
  sessionId: string;
  snapshotId: string;
  capturedAt: Date;
  schemaVersion: number;
}

export interface SnapshotRestoredPayload {
  sessionId: string;
  snapshotId: string;
  restoredAt: Date;
}

export interface WorkspaceLockAcquiredPayload {
  sessionId: string;
  pid: number;
}

export interface WorkspaceLockReleasedPayload {
  sessionId: string;
  reason: "completed" | "failed" | "cancelled" | "stale-cleared";
}

export interface VerificationPluginRunPayload {
  method: "test-runner" | "diff-check" | "schema-validator" | "output-compare" | "manual";
  status: "pass" | "fail" | "partial" | "skipped";
  score?: number;
  durationMs: number;
  evidenceCount: number;
}

export interface RunbookGeneratedPayload {
  sessionId: string;
  path: string;
  stepCount: number;
}

export interface ProfileSelectedPayload {
  profile: "safe-local" | "vibe" | "platform";
  source: "builtin" | "flag" | "global" | "default-deny";
}

export interface PolicyResolvedPayload {
  profile: "safe-local" | "vibe" | "platform";
  source: "builtin" | "flag" | "global" | "default-deny";
  policyFilePath?: string;
  allowedExecutables?: string[];
  allowNetwork?: boolean;
  allowRemote?: boolean;
  defaultDeny: boolean;
}

export interface AutomationSourceLifecyclePayload {
  sourceType: "cron" | "watcher";
  namedGoalId: string;
  reason?: string;
  error?: string;
}

export interface AutomationTriggeredPayload {
  sourceType: "cron" | "watcher";
  namedGoalId: string;
  payload?: Record<string, unknown>;
}

export interface EventInjectedPayload {
  namedGoalId: string;
  sessionId: string;
  action: "skipped" | "resumed" | "created";
}

export interface PolicyMeta {
  profile?: string;
  category?: string;
  riskLevel?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface EventPayloadByType {
  "session.started": SessionStartedPayload;
  "session.blocked": SessionBlockedPayload;
  "session.completed": SessionCompletedPayload;
  "session.failed": SessionFailedPayload;
  "session.cancelled": SessionCancelledPayload;
  "workitem.started": WorkItemLifecyclePayload;
  "workitem.completed": WorkItemLifecyclePayload;
  "workitem.skipped": WorkItemLifecyclePayload;
  "workitem.failed": WorkItemLifecyclePayload;
  "context.loaded": ContextLoadedPayload;
  "decision.made": DecisionMadePayload;
  "action.requested": ActionRequestedPayload;
  "action.completed": ActionCompletedPayload;
  "verification.requested": VerificationRequestedPayload;
  "verification.completed": VerificationCompletedPayload;
  "artifact.emitted": ArtifactEmittedPayload;
  "file.read": FileReadPayload;
  "file.patched": FilePatchedPayload;
  "command.executed": CommandExecutedPayload;
  "model.call": ModelCallPayload;
  "snapshot.captured": SnapshotCapturedPayload;
  "snapshot.restored": SnapshotRestoredPayload;
  "workspace.lock.acquired": WorkspaceLockAcquiredPayload;
  "workspace.lock.released": WorkspaceLockReleasedPayload;
  "verification.plugin.run": VerificationPluginRunPayload;
  "runbook.generated": RunbookGeneratedPayload;
  "profile.selected": ProfileSelectedPayload;
  "policy.resolved": PolicyResolvedPayload;
  "automation.source.started": AutomationSourceLifecyclePayload;
  "automation.source.stopped": AutomationSourceLifecyclePayload;
  "automation.source.failed": AutomationSourceLifecyclePayload;
  "automation.triggered": AutomationTriggeredPayload;
  "event.injected": EventInjectedPayload;
}

export type EventPayload = EventPayloadByType[WorkEventType];

interface BaseWorkEvent<T extends WorkEventType> {
  id: string;
  timestamp: Date;
  sessionId: string;
  goalId: string;
  workItemId?: string;
  type: T;
  sourceLayer: SourceLayer;
  causalityRef?: string;
  artifactRefs?: string[];
  payload: EventPayloadByType[T];
  policyMeta?: PolicyMeta;
}

export type WorkEvent = {
  [T in WorkEventType]: BaseWorkEvent<T>;
}[WorkEventType];
