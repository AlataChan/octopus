import type { Action, ActionResult, WorkGoal, WorkSession } from "@octopus/work-contracts";

export interface RuntimeContext {
  pendingResults: ActionResult[];
  contextPayload?: ContextPayload;
}

export interface SessionSnapshot {
  schemaVersion: 2;
  snapshotId: string;
  capturedAt: Date;
  session: WorkSession;
  runtimeContext: RuntimeContext;
}

export interface RuntimeMetadata {
  runtimeType: "embedded" | "cli" | "acp" | "remote";
  model?: string;
  profile?: string;
}

export interface McpToolDescription {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ContextPayload {
  workspaceSummary?: string;
  visibleFiles?: string[];
  plan?: string;
  todo?: string;
  status?: string;
  mcpTools?: McpToolDescription[];
}

export interface CompletionCandidate {
  evidence: string;
  artifactRefs?: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
}

export type RuntimeResponse =
  | { kind: "action"; action: Action; usage?: TokenUsage }
  | { kind: "completion"; evidence: string; usage?: TokenUsage }
  | { kind: "blocked"; reason: string; usage?: TokenUsage }
  | { kind: "clarification"; question: string; usage?: TokenUsage };

export type ResumeInput =
  | { kind: "clarification"; answer: string }
  | { kind: "approval"; decision: "approve" | "reject" }
  | { kind: "operator" };

export interface SessionPlane {
  initSession(goal: WorkGoal): Promise<WorkSession>;
  pauseSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string, input?: ResumeInput): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  snapshotSession(sessionId: string): Promise<SessionSnapshot>;
  hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession>;
  getMetadata(sessionId: string): Promise<RuntimeMetadata>;
}

export interface ExecutionPlane {
  loadContext(sessionId: string, context: ContextPayload): Promise<void>;
  requestNextAction(sessionId: string): Promise<RuntimeResponse>;
  ingestToolResult(sessionId: string, actionId: string, result: ActionResult): Promise<void>;
  signalCompletion(sessionId: string, candidate: CompletionCandidate): void;
  signalBlocked(sessionId: string, reason: string): void;
}

export interface AgentRuntime extends SessionPlane, ExecutionPlane {
  readonly type: "embedded" | "cli" | "acp" | "remote";
}
