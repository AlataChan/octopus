import type { WorkEvent } from "@octopus/observability";
import type { SessionSummary, WorkSession } from "@octopus/work-contracts";

export interface RemoteClientConfig {
  gatewayUrl: string;
  apiKey: string;
}

export interface ApprovalRequestedMessage {
  promptId: string;
  description: string;
  riskLevel: string;
}

export interface RemoteAttachHandle {
  sendControl: (action: "pause" | "cancel" | "resume") => Promise<void>;
  sendApproval: (promptId: string, action: "approve" | "deny") => Promise<void>;
  detach: () => void;
}

interface RemoteClientDependencies {
  fetchFn?: typeof fetch;
  createSocket?: (url: string) => ClientSocket;
}

interface TokenResponse {
  token: string;
  expiresAt: string;
}

interface ClientSocket {
  addEventListener(type: "open", handler: () => void): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", handler: () => void): void;
  addEventListener(type: "close", handler: (event: { reason?: string }) => void): void;
  send(data: string): void;
  close(): void;
}

export class RemoteClient {
  private readonly fetchFn: typeof fetch;
  private readonly createSocket: (url: string) => ClientSocket;

  constructor(
    private readonly config: RemoteClientConfig,
    dependencies: RemoteClientDependencies = {}
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.createSocket = dependencies.createSocket ?? ((url) => new WebSocket(url) as unknown as ClientSocket);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const response = await this.requestJson<SessionSummary[]>("GET", "/api/sessions");
    return response.map(reviveSessionSummary);
  }

  async getSession(sessionId: string): Promise<WorkSession> {
    return reviveWorkSession(await this.requestJson<WorkSession>("GET", `/api/sessions/${encodeURIComponent(sessionId)}`));
  }

  async submitGoal(description: string): Promise<{ sessionId: string; goalId: string; state: string }> {
    return this.requestJson("POST", "/api/goals", { description });
  }

  async controlSession(sessionId: string, action: "pause" | "cancel" | "resume"): Promise<void> {
    await this.requestJson("POST", `/api/sessions/${encodeURIComponent(sessionId)}/control`, { action });
  }

  async approveSession(sessionId: string, promptId: string, action: "approve" | "deny"): Promise<void> {
    await this.requestJson("POST", `/api/sessions/${encodeURIComponent(sessionId)}/approval`, {
      promptId,
      action
    });
  }

  async mintToken(): Promise<TokenResponse> {
    return this.requestJson("POST", "/auth/token");
  }

  async attachToSession(
    sessionId: string,
    onEvent: (event: WorkEvent) => void,
    onClose: (reason: string) => void,
    onApprovalRequested?: (message: ApprovalRequestedMessage) => void
  ): Promise<RemoteAttachHandle> {
    const { token } = await this.mintToken();
    const socket = this.createSocket(resolveSocketUrl(this.config.gatewayUrl, sessionId));

    await new Promise<void>((resolve, reject) => {
      let authenticated = false;

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token }));
      });

      socket.addEventListener("message", (event) => {
        const message = safeParse(event.data);
        if (!message || typeof message.type !== "string") {
          return;
        }

        if (message.type === "auth.ok") {
          authenticated = true;
          resolve();
          return;
        }

        if (message.type === "auth.failed" || message.type === "auth.timeout" || message.type === "auth.expired") {
          reject(new Error(String(message.reason ?? message.error ?? message.type)));
          return;
        }
      });

      socket.addEventListener("error", () => {
        reject(new Error("Remote session socket failed to open."));
      });

      socket.addEventListener("close", (event) => {
        if (!authenticated) {
          reject(new Error(event.reason || "Remote session socket closed during authentication."));
        }
      });
    });

    socket.addEventListener("message", (event) => {
      const message = safeParse(event.data);
      if (!message || typeof message.type !== "string") {
        return;
      }

      if (message.type === "backfill" && Array.isArray(message.events)) {
        for (const entry of message.events) {
          onEvent(reviveWorkEvent(entry as WorkEvent));
        }
        return;
      }

      if (message.type === "approval.requested") {
        onApprovalRequested?.({
          promptId: String(message.promptId ?? ""),
          description: String(message.description ?? ""),
          riskLevel: String(message.riskLevel ?? "")
        });
        return;
      }

      if ("id" in message && "sessionId" in message && "timestamp" in message) {
        onEvent(reviveWorkEvent(message as unknown as WorkEvent));
      }
    });

    socket.addEventListener("close", (event) => {
      onClose(event.reason || "closed");
    });

    return {
      sendControl: async (action) => {
        await this.controlSession(sessionId, action);
      },
      sendApproval: async (promptId, action) => {
        await this.approveSession(sessionId, promptId, action);
      },
      detach: () => {
        socket.close();
      }
    };
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await this.fetchFn(resolveHttpUrl(this.config.gatewayUrl, path), {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `Remote request failed with status ${response.status}`);
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
