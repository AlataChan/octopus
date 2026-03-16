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

export type WorkEventType =
  | SessionEventType
  | WorkItemEventType
  | CoreEventType
  | SubstrateEventType;

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
