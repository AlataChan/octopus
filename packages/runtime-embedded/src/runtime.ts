import { randomUUID } from "node:crypto";

import type {
  AgentRuntime,
  CompletionCandidate,
  ContextPayload,
  RuntimeMetadata,
  RuntimeResponse,
  SessionSnapshot
} from "@octopus/agent-runtime";
import type { EventBus } from "@octopus/observability";
import { createWorkSession, type ActionResult, type WorkGoal, type WorkSession } from "@octopus/work-contracts";

import type { EmbeddedRuntimeConfig } from "./config.js";

export interface ModelTelemetry {
  endpoint: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  statusCode?: number;
  success: boolean;
  error?: string;
}

export interface ModelTurnResult {
  response: RuntimeResponse;
  telemetry: ModelTelemetry;
}

export class ModelTurnError extends Error {
  constructor(
    message: string,
    public readonly telemetry: ModelTelemetry
  ) {
    super(message);
    this.name = "ModelTurnError";
  }
}

export interface ModelClient {
  completeTurn(input: {
    session: WorkSession;
    context?: ContextPayload;
    results: ActionResult[];
    config: EmbeddedRuntimeConfig;
  }): Promise<ModelTurnResult>;
}

export class EmbeddedRuntime implements AgentRuntime {
  readonly type = "embedded" as const;

  private readonly sessions = new Map<string, WorkSession>();
  private readonly contexts = new Map<string, ContextPayload>();
  private readonly results = new Map<string, ActionResult[]>();

  constructor(
    private readonly config: EmbeddedRuntimeConfig,
    private readonly modelClient: ModelClient,
    private readonly eventBus: EventBus
  ) {}

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    const session = createWorkSession(goal);
    this.sessions.set(session.id, session);
    this.results.set(session.id, []);
    return session;
  }

  async pauseSession(): Promise<void> {}

  async resumeSession(): Promise<void> {}

  async cancelSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.contexts.delete(sessionId);
    this.results.delete(sessionId);
  }

  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return {
      schemaVersion: 2,
      snapshotId: randomUUID(),
      capturedAt: new Date(),
      session,
      runtimeContext: {
        pendingResults: this.results.get(sessionId) ?? [],
        contextPayload: this.contexts.get(sessionId)
      }
    };
  }

  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
    if (snapshot.schemaVersion !== 2) {
      throw new Error(`Unsupported snapshot schema version: ${snapshot.schemaVersion}`);
    }

    const { session, runtimeContext } = snapshot;
    this.sessions.set(session.id, session);
    this.results.set(session.id, runtimeContext.pendingResults);
    if (runtimeContext.contextPayload) {
      this.contexts.set(session.id, runtimeContext.contextPayload);
    } else {
      this.contexts.delete(session.id);
    }
    return session;
  }

  async getMetadata(): Promise<RuntimeMetadata> {
    return {
      runtimeType: this.type,
      model: this.config.model
    };
  }

  async loadContext(sessionId: string, context: ContextPayload): Promise<void> {
    this.contexts.set(sessionId, context);
  }

  async requestNextAction(sessionId: string): Promise<RuntimeResponse> {
    if (!this.config.allowModelApiCall) {
      throw new Error("Model API calls are disabled for this runtime.");
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    try {
      const turn = await this.modelClient.completeTurn({
        session,
        context: this.contexts.get(sessionId),
        results: this.results.get(sessionId) ?? [],
        config: this.config
      });

      this.emitModelCall(sessionId, session.goalId, turn.telemetry);
      return turn.response;
    } catch (error) {
      const turnError = toModelTurnError(error, this.config);
      this.emitModelCall(sessionId, session.goalId, turnError.telemetry);
      return {
        kind: "blocked",
        reason: turnError.message
      };
    }
  }

  async ingestToolResult(sessionId: string, _actionId: string, result: ActionResult): Promise<void> {
    const existing = this.results.get(sessionId) ?? [];
    existing.push(result);
    this.results.set(sessionId, existing);
  }

  signalCompletion(_sessionId: string, _candidate: CompletionCandidate): void {}

  signalBlocked(_sessionId: string, _reason: string): void {}

  private emitModelCall(sessionId: string, goalId: string, telemetry: ModelTelemetry): void {
    this.eventBus.emit({
      id: randomUUID(),
      timestamp: new Date(),
      sessionId,
      goalId,
      type: "model.call",
      sourceLayer: "runtime",
      payload: {
        provider: this.config.provider,
        model: this.config.model,
        endpoint: telemetry.endpoint,
        inputTokens: telemetry.inputTokens,
        outputTokens: telemetry.outputTokens,
        durationMs: telemetry.durationMs,
        success: telemetry.success,
        requestId: telemetry.requestId,
        statusCode: telemetry.statusCode,
        error: telemetry.error
      }
    });
  }
}

function toModelTurnError(error: unknown, config: EmbeddedRuntimeConfig): ModelTurnError {
  if (error instanceof ModelTurnError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Model turn failed.";
  return new ModelTurnError(message, {
    endpoint: resolveConfiguredEndpoint(config),
    durationMs: 0,
    success: false,
    error: message
  });
}

function resolveConfiguredEndpoint(config: EmbeddedRuntimeConfig): string {
  if (config.provider === "anthropic") {
    return config.baseUrl ?? "https://api.anthropic.com/v1/messages";
  }

  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}
