import type { SessionState, SkillId } from "@octopus/work-contracts";

export type SourceLayer =
  | "work-core"
  | "runtime"
  | "substrate"
  | "automation"
  | "surface"
  | "gateway"
  | "mcp"
  | "chat";

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
  | "action.progress"
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

export type GatewayEventType =
  | "gateway.started"
  | "gateway.stopped"
  | "gateway.client.connected"
  | "gateway.client.disconnected"
  | "gateway.auth.failed";

export type RemoteSessionEventType =
  | "remote.session.attached"
  | "remote.session.detached"
  | "remote.goal.submitted"
  | "remote.approval.requested"
  | "remote.approval.resolved";

export type McpEventType =
  | "mcp.server.connected"
  | "mcp.server.disconnected"
  | "mcp.tool.called"
  | "mcp.tool.completed"
  | "mcp.tool.failed";

export type ChatEventType =
  | "chat.goal.received"
  | "chat.notification.sent"
  | "chat.notification.failed";

export type MemoryEventType =
  | "memory.retrieved"
  | "memory.injected"
  | "memory.promoted"
  | "memory.outcome";

export type KbAdapterEventType =
  | "kb.adapter.call.started"
  | "kb.adapter.call.completed"
  | "kb.adapter.call.failed"
  | "kb.adapter.unavailable";

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
  | AutomationEventType
  | GatewayEventType
  | RemoteSessionEventType
  | McpEventType
  | ChatEventType
  | MemoryEventType
  | KbAdapterEventType;

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

export interface ActionProgressPayload {
  actionId: string;
  actionType: string;
  stream: "stdout" | "stderr" | "info";
  chunk: string;
  bytesTotal?: number;
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

export interface GatewayStartedPayload {
  port: number;
  host: string;
  tlsEnabled: boolean;
}

export interface GatewayStoppedPayload {
  reason: string;
}

export interface GatewayClientConnectedPayload {
  clientId: string;
  authMethod: "api-key" | "session-token";
}

export interface GatewayClientDisconnectedPayload {
  clientId: string;
  reason: string;
}

export interface GatewayAuthFailedPayload {
  clientId: string;
  method: string;
  reason: string;
}

export interface RemoteSessionAttachedPayload {
  clientId: string;
  sessionId: string;
  mode: "observe" | "control";
}

export interface RemoteSessionDetachedPayload {
  clientId: string;
  sessionId: string;
  reason: string;
}

export interface RemoteGoalSubmittedPayload {
  clientId: string;
  goalId: string;
  description: string;
}

export interface RemoteApprovalRequestedPayload {
  sessionId: string;
  promptId: string;
  description: string;
  riskLevel: string;
}

export interface RemoteApprovalResolvedPayload {
  sessionId: string;
  promptId: string;
  action: "approve" | "deny";
  clientId: string;
}

export interface McpServerConnectedPayload {
  serverId: string;
  transport: "stdio" | "streamable-http" | "sse";
  toolCount: number;
}

export interface McpServerDisconnectedPayload {
  serverId: string;
  reason: string;
}

export interface McpToolCalledPayload {
  serverId: string;
  toolName: string;
  sessionId: string;
}

export interface McpToolCompletedPayload {
  serverId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
}

export interface McpToolFailedPayload {
  serverId: string;
  toolName: string;
  error: string;
}

export interface ChatGoalReceivedPayload {
  platform: string;
  channelId: string;
  userId: string;
  goalDescription: string;
}

export interface ChatNotificationSentPayload {
  platform: string;
  channelId: string;
  sessionId: string;
  notificationType: "ack" | "completion" | "failure";
}

export interface ChatNotificationFailedPayload {
  platform: string;
  channelId: string;
  sessionId: string;
  error: string;
}

export type MemorySourcePayload =
  | { kind: "trace-event"; sessionId: string; eventId: string }
  | { kind: "artifact"; sessionId: string; path: string; lines?: [number, number] }
  | { kind: "freeform"; reason: string };

export interface MemoryRetrievedPayload {
  query: string;
  skill: SkillId;
  candidateIds: string[];
  scores: Record<string, number>;
}

export interface MemoryInjectedPayload {
  planId: string;
  includedIds: string[];
  excluded: Array<{ id: string; reason: string }>;
  tokenCost: number;
}

export interface MemoryPromotedPayload {
  recordId: string;
  source: MemorySourcePayload;
  skill: SkillId;
  kind: "decision" | "fact" | "pattern" | "open_question" | "summary" | "note";
  confirmedBy: "user" | "agent" | "rule";
}

export interface MemoryOutcomePayload {
  planId: string;
  sessionOutcome: Extract<SessionState, "completed" | "failed" | "cancelled" | "blocked">;
  artifactsProduced: number;
}

export type KbAdapterCommand = "lookup" | "retrieve-bundle" | "neighbors" | "impacted-pages";

export interface KbAdapterCallStartedPayload {
  command: KbAdapterCommand;
  vaultPathHash: string;
  queryHash?: string;
}

export interface KbAdapterCallCompletedPayload {
  command: KbAdapterCommand;
  durationMs: number;
  octopusKbVersion: string | "unknown";
  schemaHash: string;
  resultItemCount: number;
}

export type KbAdapterErrorKind = "not_installed" | "vault_invalid" | "timeout" | "schema_drift" | "command_failed";

export interface KbAdapterCallFailedPayload {
  command: KbAdapterCommand;
  durationMs: number;
  errorKind: KbAdapterErrorKind;
  message: string;
}

export interface KbAdapterUnavailablePayload {
  reason: string;
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
  "action.progress": ActionProgressPayload;
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
  "gateway.started": GatewayStartedPayload;
  "gateway.stopped": GatewayStoppedPayload;
  "gateway.client.connected": GatewayClientConnectedPayload;
  "gateway.client.disconnected": GatewayClientDisconnectedPayload;
  "gateway.auth.failed": GatewayAuthFailedPayload;
  "remote.session.attached": RemoteSessionAttachedPayload;
  "remote.session.detached": RemoteSessionDetachedPayload;
  "remote.goal.submitted": RemoteGoalSubmittedPayload;
  "remote.approval.requested": RemoteApprovalRequestedPayload;
  "remote.approval.resolved": RemoteApprovalResolvedPayload;
  "mcp.server.connected": McpServerConnectedPayload;
  "mcp.server.disconnected": McpServerDisconnectedPayload;
  "mcp.tool.called": McpToolCalledPayload;
  "mcp.tool.completed": McpToolCompletedPayload;
  "mcp.tool.failed": McpToolFailedPayload;
  "chat.goal.received": ChatGoalReceivedPayload;
  "chat.notification.sent": ChatNotificationSentPayload;
  "chat.notification.failed": ChatNotificationFailedPayload;
  "memory.retrieved": MemoryRetrievedPayload;
  "memory.injected": MemoryInjectedPayload;
  "memory.promoted": MemoryPromotedPayload;
  "memory.outcome": MemoryOutcomePayload;
  "kb.adapter.call.started": KbAdapterCallStartedPayload;
  "kb.adapter.call.completed": KbAdapterCallCompletedPayload;
  "kb.adapter.call.failed": KbAdapterCallFailedPayload;
  "kb.adapter.unavailable": KbAdapterUnavailablePayload;
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
