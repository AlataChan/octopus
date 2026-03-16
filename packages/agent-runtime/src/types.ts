import type { Action, ActionResult, WorkGoal, WorkSession } from "@octopus/work-contracts";

export interface SessionSnapshot {
  sessionId: string;
  capturedAt: Date;
  summary?: string;
}

export interface RuntimeMetadata {
  runtimeType: "embedded" | "cli" | "acp" | "remote";
  model?: string;
  profile?: string;
}

export interface ContextPayload {
  workspaceSummary?: string;
  visibleFiles?: string[];
  plan?: string;
  todo?: string;
  status?: string;
}

export interface CompletionCandidate {
  evidence: string;
  artifactRefs?: string[];
}

export type RuntimeResponse =
  | { kind: "action"; action: Action }
  | { kind: "completion"; evidence: string }
  | { kind: "blocked"; reason: string }
  | { kind: "clarification"; question: string };

export interface SessionPlane {
  initSession(goal: WorkGoal): Promise<WorkSession>;
  pauseSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  snapshotSession(sessionId: string): Promise<SessionSnapshot>;
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

