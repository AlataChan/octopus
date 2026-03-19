import { randomUUID } from "node:crypto";

import type {
  AgentRuntime,
  CompletionCandidate,
  ContextPayload,
  RuntimeMetadata,
  RuntimeResponse,
  SessionSnapshot
} from "@octopus/agent-runtime";
import type {
  Action,
  ActionResult,
  Artifact,
  Observation,
  StateTransition,
  Verification,
  WorkGoal,
  WorkItem,
  WorkSession
} from "@octopus/work-contracts";

import type { RemoteRuntimeConfig } from "./types.js";
import { RuntimeWsClient, type WsClient } from "./ws-client.js";

interface PendingRequest {
  resolve: (message: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PendingAuth {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

type IncomingMessage = Record<string, unknown> & {
  type?: string;
  requestId?: string;
  error?: string;
  reason?: string;
};

export class RemoteRuntime implements AgentRuntime {
  readonly type = "remote" as const;

  private readonly wsClient: WsClient;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private authenticated = false;
  private connectPromise?: Promise<void>;
  private pendingAuth?: PendingAuth;

  constructor(
    private readonly config: RemoteRuntimeConfig,
    wsClient?: WsClient
  ) {
    this.wsClient = wsClient ?? new RuntimeWsClient(config.connectTimeoutMs ?? 10_000);
    this.wsClient.onMessage((data) => {
      this.handleMessage(data);
    });
    this.wsClient.onClose?.(() => {
      this.handleDisconnect("Remote runtime WebSocket disconnected.");
    });
  }

  async connect(): Promise<void> {
    if (this.authenticated && this.wsClient.isConnected) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.openAndAuthenticate();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.handleDisconnect("Remote runtime disconnected.");
    await Promise.resolve(this.wsClient.close());
  }

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    return this.request("runtime.initSession", { goal }, (message) => reviveWorkSession(message.session as WorkSession));
  }

  async pauseSession(sessionId: string): Promise<void> {
    await this.request("runtime.pauseSession", { sessionId }, () => undefined);
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.request("runtime.resumeSession", { sessionId }, () => undefined);
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.request("runtime.cancelSession", { sessionId }, () => undefined);
  }

  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return this.request("runtime.snapshotSession", { sessionId }, (message) =>
      reviveSessionSnapshot(message.snapshot as SessionSnapshot)
    );
  }

  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
    return this.request("runtime.hydrateSession", { snapshot }, (message) =>
      reviveWorkSession(message.session as WorkSession)
    );
  }

  async getMetadata(sessionId: string): Promise<RuntimeMetadata> {
    return this.request("runtime.getMetadata", { sessionId }, (message) => message.metadata as RuntimeMetadata);
  }

  async loadContext(sessionId: string, context: ContextPayload): Promise<void> {
    await this.request("runtime.loadContext", { sessionId, context }, () => undefined);
  }

  async requestNextAction(sessionId: string): Promise<RuntimeResponse> {
    return this.request("runtime.requestNextAction", { sessionId }, (message) =>
      reviveRuntimeResponse(message.response as RuntimeResponse)
    );
  }

  async ingestToolResult(sessionId: string, actionId: string, result: ActionResult): Promise<void> {
    await this.request("runtime.ingestToolResult", { sessionId, actionId, result }, () => undefined);
  }

  signalCompletion(sessionId: string, candidate: CompletionCandidate): void {
    this.assertConnected();
    this.send({
      type: "runtime.signalCompletion",
      sessionId,
      candidate
    });
  }

  signalBlocked(sessionId: string, reason: string): void {
    this.assertConnected();
    this.send({
      type: "runtime.signalBlocked",
      sessionId,
      reason
    });
  }

  private async openAndAuthenticate(): Promise<void> {
    const authMessage = this.buildAuthMessage();
    await this.wsClient.connect(resolveRuntimeUrl(this.config.gatewayUrl));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAuth = undefined;
        reject(new Error("Remote runtime authentication timed out."));
      }, this.config.connectTimeoutMs ?? 10_000);
      timeout.unref?.();

      this.pendingAuth = {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingAuth = undefined;
          this.authenticated = true;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.pendingAuth = undefined;
          reject(error);
        },
        timeout
      };

      this.send(authMessage);
    });
  }

  private buildAuthMessage(): { type: "auth"; apiKey?: string; token?: string } {
    if (this.config.sessionToken) {
      return {
        type: "auth",
        token: this.config.sessionToken
      };
    }

    if (this.config.apiKey) {
      return {
        type: "auth",
        apiKey: this.config.apiKey
      };
    }

    throw new Error("Remote runtime requires either apiKey or sessionToken.");
  }

  private async request<T>(
    type: string,
    payload: Record<string, unknown>,
    select: (message: Record<string, unknown>) => T
  ): Promise<T> {
    if (!this.authenticated || !this.wsClient.isConnected) {
      await this.connect();
    }

    const requestId = randomUUID();
    const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Remote runtime request timed out: ${type}`));
      }, this.config.requestTimeoutMs ?? 30_000);
      timeout.unref?.();

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout
      });

      this.send({
        type,
        requestId,
        ...payload
      });
    });

    return select(message);
  }

  private send(message: Record<string, unknown>): void {
    this.wsClient.send(JSON.stringify(message));
  }

  private handleMessage(raw: string): void {
    const message = safeParse(raw);
    if (!message?.type) {
      return;
    }

    if (message.type === "auth.ok") {
      this.pendingAuth?.resolve();
      return;
    }

    if (message.type === "auth.failed" || message.type === "auth.timeout" || message.type === "auth.expired") {
      const reason = message.reason ?? message.error ?? message.type;
      this.authenticated = false;
      this.pendingAuth?.reject(new Error(String(reason)));
      return;
    }

    if (message.type === "error") {
      const error = new Error(String(message.reason ?? "Remote runtime gateway error."));
      this.pendingAuth?.reject(error);
      this.rejectAllPending(error);
      return;
    }

    if (message.type === "runtime.error" && typeof message.requestId === "string") {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.requestId);
      pending.reject(new Error(String(message.error ?? "Remote runtime request failed.")));
      return;
    }

    if (message.type.endsWith(".result") && typeof message.requestId === "string") {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.requestId);
      pending.resolve(message);
    }
  }

  private handleDisconnect(reason: string): void {
    this.authenticated = false;
    this.pendingAuth?.reject(new Error(reason));
    this.rejectAllPending(new Error(reason));
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(requestId);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private assertConnected(): void {
    if (!this.authenticated || !this.wsClient.isConnected) {
      throw new Error("Remote runtime is not connected.");
    }
  }
}

function safeParse(raw: string): IncomingMessage | null {
  try {
    return JSON.parse(raw) as IncomingMessage;
  } catch {
    return null;
  }
}

function resolveRuntimeUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ws/runtime";
  } else if (!url.pathname.endsWith("/ws/runtime")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/runtime`;
  }

  return url.toString();
}

function reviveRuntimeResponse(response: RuntimeResponse): RuntimeResponse {
  if (response.kind !== "action") {
    return response;
  }

  return {
    ...response,
    action: reviveAction(response.action)
  };
}

function reviveSessionSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    capturedAt: reviveDate(snapshot.capturedAt),
    session: reviveWorkSession(snapshot.session)
  };
}

function reviveWorkSession(session: WorkSession): WorkSession {
  return {
    ...session,
    observations: session.observations.map(reviveObservation),
    artifacts: session.artifacts.map(reviveArtifact),
    items: session.items.map(reviveWorkItem),
    transitions: session.transitions.map(reviveTransition),
    createdAt: reviveDate(session.createdAt),
    updatedAt: reviveDate(session.updatedAt)
  };
}

function reviveWorkItem(item: WorkItem): WorkItem {
  return {
    ...item,
    observations: item.observations.map(reviveObservation),
    actions: item.actions.map(reviveAction),
    verifications: item.verifications.map(reviveVerification),
    createdAt: reviveDate(item.createdAt)
  };
}

function reviveObservation(observation: Observation): Observation {
  return {
    ...observation,
    createdAt: reviveDate(observation.createdAt)
  };
}

function reviveArtifact(artifact: Artifact): Artifact {
  return {
    ...artifact,
    createdAt: reviveDate(artifact.createdAt)
  };
}

function reviveAction(action: Action): Action {
  return {
    ...action,
    createdAt: reviveDate(action.createdAt)
  };
}

function reviveVerification(verification: Verification): Verification {
  return {
    ...verification,
    createdAt: reviveDate(verification.createdAt)
  };
}

function reviveTransition(transition: StateTransition): StateTransition {
  return {
    ...transition,
    timestamp: reviveDate(transition.timestamp)
  };
}

function reviveDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
