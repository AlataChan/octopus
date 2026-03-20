import type { WorkEvent } from "@octopus/observability";
import type { SessionSummary, WorkSession } from "@octopus/work-contracts";

import { MemoryAuthStore, type AuthStore } from "./auth.js";

export interface GoalSubmissionResponse {
  sessionId: string;
  goalId: string;
  state: string;
}

export interface GoalSubmissionInput {
  description: string;
  namedGoalId?: string;
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
  tlsEnabled: boolean;
  trustProxyCIDRs: string[];
  host: string;
  port: number;
  allowRemote: boolean;
  activeSessionCount: number;
  connectedClients: number;
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

type ConnectionState = "connecting" | "connected" | "disconnected";

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authStore: AuthStore = new MemoryAuthStore()
  ) {}

  async login(apiKey: string): Promise<void> {
    const response = await fetch(resolveHttpUrl(this.baseUrl, "/auth/token"), {
      method: "POST",
      headers: {
        "X-API-Key": apiKey
      }
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Login failed."));
    }

    const payload = await response.json() as { token: string };
    this.authStore.setToken(payload.token);
  }

  logout(): void {
    this.authStore.clear();
  }

  isAuthenticated(): boolean {
    return Boolean(this.authStore.getToken());
  }

  async listSessions(): Promise<SessionSummary[]> {
    const payload = await this.requestJson<SessionSummary[]>("GET", "/api/sessions");
    return payload.map(reviveSessionSummary);
  }

  async getSession(id: string): Promise<WorkSession> {
    return reviveWorkSession(await this.requestJson<WorkSession>("GET", `/api/sessions/${encodeURIComponent(id)}`));
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
    const token = this.requireToken();
    const socket = new WebSocket(resolveSocketUrl(this.baseUrl, sessionId));

    socket.addEventListener("open", () => {
      onConnectionChange?.("connecting");
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
    const response = await fetch(resolveHttpUrl(this.baseUrl, path), {
      method,
      headers: {
        ...this.getAuthHeaders(),
        "Content-Type": "application/json"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Gateway request failed."));
    }

    return response.json() as Promise<T>;
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.requireToken()}`
    };
  }

  private requireToken(): string {
    const token = this.authStore.getToken();
    if (!token) {
      throw new Error("Not authenticated.");
    }
    return token;
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
