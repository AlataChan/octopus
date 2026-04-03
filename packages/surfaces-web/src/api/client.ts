import type { WorkEvent } from "@octopus/observability";
import type { SnapshotSummary } from "@octopus/state-store";
import type { SessionSummary, WorkSession } from "@octopus/work-contracts";

import {
  SessionStorageAuthStore,
  type AuthRole,
  type AuthSession,
  type AuthStore
} from "./auth.js";

export interface GoalSubmissionResponse {
  sessionId: string;
  goalId: string;
  state: string;
}

export interface GoalSubmissionInput {
  description: string;
  namedGoalId?: string;
  taskTitle?: string;
}

export interface ArtifactContentResponse {
  path: string;
  type: string;
  contentType: string;
  content: string;
}

export interface StatusResponse {
  profile: string;
  apiKeyConfigured: boolean;
  browserLoginConfigured?: boolean;
  configuredUsers?: number;
  tlsEnabled: boolean;
  trustProxyCIDRs: string[];
  host: string;
  port: number;
  allowRemote: boolean;
  activeSessionCount: number;
  connectedClients: number;
  traceStreamingAvailable?: boolean;
  currentRole?: AuthRole;
  currentOperator?: string;
}

export interface ApprovalRequest {
  promptId: string;
  description: string;
  riskLevel: string;
}

export interface EventStreamHandle {
  detach: () => void;
  sendClarification: (answer: string) => void;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  role: AuthRole;
  username: string;
}

export interface RollbackResponse {
  sessionId: string;
  state: string;
  restoredFromSessionId: string;
  snapshotId: string;
}

export interface SetupStatusResponse {
  initialized: boolean;
  workspaceWritable: boolean;
}

export interface SetupTokenValidationResponse {
  valid: boolean;
}

export interface SetupRuntimeConfigInput {
  provider: "openai-compatible";
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface SetupRuntimeValidationResponse {
  valid: boolean;
  latencyMs?: number;
  error?: string;
}

export interface SetupAdditionalUserInput {
  username: string;
  password: string;
  role: "operator" | "viewer";
}

export interface SetupInitializeInput {
  runtime: SetupRuntimeConfigInput;
  admin: {
    username: string;
    password: string;
  };
  additionalUsers?: SetupAdditionalUserInput[];
}

export interface SetupInitializeResponse {
  initialized: true;
}

type ConnectionState = "connecting" | "connected" | "disconnected";

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authStore: AuthStore = new SessionStorageAuthStore()
  ) {}

  async login(username: string, password: string): Promise<AuthSession> {
    const response = await fetch(resolveHttpUrl(this.baseUrl, "/auth/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password
      })
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Login failed."));
    }

    const payload = await response.json() as LoginResponse;
    const session = {
      token: payload.token,
      expiresAt: payload.expiresAt,
      role: payload.role,
      username: payload.username
    } satisfies AuthSession;
    this.authStore.setSession(session);
    return session;
  }

  async logout(): Promise<void> {
    const session = this.authStore.getSession();
    if (!session) {
      this.authStore.clear();
      return;
    }

    const response = await fetch(resolveHttpUrl(this.baseUrl, "/auth/logout"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });

    if (response.ok || response.status === 401 || response.status === 403) {
      this.authStore.clear();
      return;
    }

    throw new Error(await readErrorMessage(response, "Logout failed."));
  }

  clearAuthSession(): void {
    this.authStore.clear();
  }

  isAuthenticated(): boolean {
    return Boolean(this.authStore.getSession());
  }

  getAuthSession(): AuthSession | null {
    return this.authStore.getSession();
  }

  async getSetupStatus(): Promise<SetupStatusResponse> {
    return this.requestJsonWithOptions<SetupStatusResponse>("GET", "/api/setup/status", {
      auth: false
    });
  }

  async validateSetupToken(token: string): Promise<SetupTokenValidationResponse> {
    return this.requestJsonWithOptions<SetupTokenValidationResponse>("POST", "/api/setup/validate-token", {
      auth: false,
      headers: {
        "X-Setup-Token": token
      }
    });
  }

  async validateRuntime(
    token: string,
    runtime: SetupRuntimeConfigInput
  ): Promise<SetupRuntimeValidationResponse> {
    return this.requestJsonWithOptions<SetupRuntimeValidationResponse>("POST", "/api/setup/validate-runtime", {
      auth: false,
      headers: {
        "X-Setup-Token": token
      },
      body: runtime
    });
  }

  async initialize(
    token: string,
    payload: SetupInitializeInput
  ): Promise<SetupInitializeResponse> {
    return this.requestJsonWithOptions<SetupInitializeResponse>("POST", "/api/setup/initialize", {
      auth: false,
      headers: {
        "X-Setup-Token": token
      },
      body: payload
    });
  }

  async listSessions(): Promise<SessionSummary[]> {
    const payload = await this.requestJson<SessionSummary[]>("GET", "/api/sessions");
    return payload.map(reviveSessionSummary);
  }

  async getSession(id: string): Promise<WorkSession> {
    return reviveWorkSession(await this.requestJson<WorkSession>("GET", `/api/sessions/${encodeURIComponent(id)}`));
  }

  async listSnapshots(sessionId: string): Promise<SnapshotSummary[]> {
    const payload = await this.requestJson<Array<Omit<SnapshotSummary, "capturedAt"> & { capturedAt: string }>>(
      "GET",
      `/api/sessions/${encodeURIComponent(sessionId)}/snapshots`
    );
    return payload.map((snapshot) => ({
      ...snapshot,
      capturedAt: new Date(snapshot.capturedAt)
    }));
  }

  async submitGoal(input: GoalSubmissionInput): Promise<GoalSubmissionResponse> {
    return this.requestJson<GoalSubmissionResponse>("POST", "/api/goals", input);
  }

  async controlSession(id: string, action: "pause" | "resume" | "cancel"): Promise<void> {
    await this.requestJson("POST", `/api/sessions/${encodeURIComponent(id)}/control`, { action });
  }

  async approvePrompt(sessionId: string, promptId: string, action: "approve" | "deny"): Promise<void> {
    await this.requestJson("POST", `/api/sessions/${encodeURIComponent(sessionId)}/approval`, {
      promptId,
      action
    });
  }

  async submitClarification(sessionId: string, answer: string): Promise<void> {
    await this.requestJson("POST", `/api/sessions/${encodeURIComponent(sessionId)}/clarification`, {
      answer
    });
  }

  async rollbackSession(sessionId: string, snapshotId?: string): Promise<RollbackResponse> {
    return this.requestJson<RollbackResponse>("POST", `/api/sessions/${encodeURIComponent(sessionId)}/rollback`, (
      snapshotId ? { snapshotId } : undefined
    ));
  }

  async getStatus(): Promise<StatusResponse> {
    return this.requestJson<StatusResponse>("GET", "/api/status");
  }

  async getArtifactContent(sessionId: string, path: string): Promise<ArtifactContentResponse> {
    return this.requestJson<ArtifactContentResponse>(
      "GET",
      `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/content?path=${encodeURIComponent(path)}`
    );
  }

  connectEventStream(
    sessionId: string,
    onEvent: (event: WorkEvent) => void,
    onApproval: (request: ApprovalRequest) => void,
    onClose: (reason: string) => void,
    onConnectionChange?: (state: ConnectionState) => void
  ): EventStreamHandle {
    const token = this.requireSession().token;
    const socket = new WebSocket(resolveSocketUrl(this.baseUrl, sessionId));

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token }));
    });

    socket.addEventListener("message", (event) => {
      const message = safeParse(event.data);
      if (!message || typeof message.type !== "string") {
        return;
      }

      if (message.type === "auth.ok") {
        onConnectionChange?.("connected");
        return;
      }

      if (message.type === "backfill" && Array.isArray(message.events)) {
        for (const item of message.events) {
          onEvent(reviveWorkEvent(item as unknown as WorkEvent));
        }
        return;
      }

      if (message.type === "approval.requested") {
        onApproval({
          promptId: String(message.promptId ?? ""),
          description: String(message.description ?? ""),
          riskLevel: String(message.riskLevel ?? "")
        });
        return;
      }

      if (message.type === "auth.failed" || message.type === "auth.timeout" || message.type === "auth.expired") {
        socket.close();
        onClose(String(message.reason ?? message.error ?? message.type));
        return;
      }

      if ("id" in message && "sessionId" in message && "timestamp" in message) {
        onEvent(reviveWorkEvent(message as unknown as WorkEvent));
      }
    });

    socket.addEventListener("close", (event) => {
      onConnectionChange?.("disconnected");
      onClose(event.reason || "closed");
    });

    return {
      detach: () => {
        socket.close();
      },
      sendClarification: (answer: string) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "clarification", answer }));
        }
      }
    };
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    return this.requestJsonWithOptions<T>(method, path, { body });
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.requireSession().token}`
    };
  }

  private requireSession(): AuthSession {
    const session = this.authStore.getSession();
    if (!session) {
      throw new Error("Not authenticated.");
    }
    return session;
  }

  private async requestJsonWithOptions<T>(
    method: "GET" | "POST",
    path: string,
    options: {
      auth?: boolean;
      headers?: Record<string, string>;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const headers = {
      ...(options.auth === false ? {} : this.getAuthHeaders()),
      ...(options.headers ?? {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
    };
    const response = await fetch(resolveHttpUrl(this.baseUrl, path), {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Gateway request failed."));
    }

    return response.json() as Promise<T>;
  }
}

function resolveHttpUrl(baseUrl: string, path: string): string {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function resolveSocketUrl(baseUrl: string, sessionId: string): string {
  const url = new URL(ensureTrailingSlash(baseUrl));
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.pathname = `/ws/sessions/${encodeURIComponent(sessionId)}/events`;
  return url.toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function safeParse(raw: unknown): Record<string, unknown> | null {
  try {
    return typeof raw === "string"
      ? JSON.parse(raw) as Record<string, unknown>
      : JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

function reviveSessionSummary(summary: SessionSummary): SessionSummary {
  return {
    ...summary,
    updatedAt: reviveDate(summary.updatedAt)
  };
}

function reviveWorkSession(session: WorkSession): WorkSession {
  return {
    ...session,
    createdAt: reviveDate(session.createdAt),
    updatedAt: reviveDate(session.updatedAt),
    observations: session.observations.map((observation) => ({
      ...observation,
      createdAt: reviveDate(observation.createdAt)
    })),
    artifacts: session.artifacts.map((artifact) => ({
      ...artifact,
      createdAt: reviveDate(artifact.createdAt)
    })),
    transitions: session.transitions.map((transition) => ({
      ...transition,
      timestamp: reviveDate(transition.timestamp)
    })),
    items: session.items.map((item) => ({
      ...item,
      createdAt: reviveDate(item.createdAt),
      observations: item.observations.map((observation) => ({
        ...observation,
        createdAt: reviveDate(observation.createdAt)
      })),
      actions: item.actions.map((action) => ({
        ...action,
        createdAt: reviveDate(action.createdAt)
      })),
      verifications: item.verifications.map((verification) => ({
        ...verification,
        createdAt: reviveDate(verification.createdAt)
      }))
    }))
  };
}

function reviveWorkEvent(event: WorkEvent): WorkEvent {
  return {
    ...event,
    timestamp: reviveDate(event.timestamp)
  };
}

function reviveDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
