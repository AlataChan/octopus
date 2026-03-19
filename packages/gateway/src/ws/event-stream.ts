import { randomUUID } from "node:crypto";

import type { RawData, WebSocket, WebSocketServer } from "ws";

import type { WorkEvent } from "@octopus/observability";

import { validateApiKey } from "../auth.js";
import { handleApproval, type ApprovalBody } from "../routes/approval.js";
import { handleControl, type ControlBody } from "../routes/control.js";
import type { RouteDeps } from "../routes/shared.js";
import type { OperatorContext } from "../types.js";

interface AuthMessage {
  type: "auth";
  token?: string;
  apiKey?: string;
}

interface ControlMessage {
  type: "control";
  action: ControlBody["action"];
}

interface ApprovalMessage {
  type: "approval";
  promptId: string;
  action: ApprovalBody["action"];
}

type EventStreamMessage = AuthMessage | ControlMessage | ApprovalMessage;

type GatewaySocket = WebSocket & {
  __octopusAuthenticated?: boolean;
  __octopusAuthMethod?: OperatorContext["authMethod"];
  __octopusClientId?: string;
  __octopusOperator?: OperatorContext;
  __octopusSessionId?: string;
  __octopusToken?: string;
};

export function handleEventStreamUpgrade(
  _wss: WebSocketServer,
  ws: WebSocket,
  sessionId: string,
  deps: RouteDeps
): void {
  const socket = ws as GatewaySocket;
  const clientId = randomUUID();
  socket.__octopusClientId = clientId;
  socket.__octopusSessionId = sessionId;

  let unsubscribe: (() => void) | undefined;
  let detachReason = "client-closed";

  const authTimeout = setTimeout(() => {
    if (socket.__octopusAuthenticated) {
      return;
    }

    sendJson(socket, { type: "auth.timeout" });
    detachReason = "auth-timeout";
    socket.close();
  }, deps.config.wsAuthTimeoutMs ?? 5_000);
  authTimeout.unref?.();

  socket.on("message", (data) => {
    void handleMessage(data);
  });

  socket.on("close", () => {
    clearTimeout(authTimeout);
    unsubscribe?.();

    if (!socket.__octopusAuthenticated) {
      return;
    }

    emitGatewayEvent(deps, "gateway.client.disconnected", {
      clientId,
      reason: detachReason
    });
    emitRemoteEvent(deps, "remote.session.detached", sessionId, {
      clientId,
      sessionId,
      reason: detachReason
    });
  });

  async function handleMessage(data: RawData): Promise<void> {
    if (!socket.__octopusAuthenticated) {
      await authenticateSocket(data);
      return;
    }

    if (hasExpiredToken(socket, deps)) {
      sendJson(socket, { type: "auth.expired" });
      detachReason = "token-expired";
      socket.close();
      return;
    }

    const parsed = parseMessage(data);
    if (!parsed) {
      sendJson(socket, { type: "error", error: "Message must be valid JSON." });
      return;
    }

    if (parsed.type === "control") {
      if (parsed.action === "cancel") {
        sendJson(socket, {
          type: "error",
          error: "Cancel is not available over the event stream."
        });
        return;
      }

      try {
        await handleControl(deps, socket.__octopusOperator!, sessionId, {
          action: parsed.action
        });
      } catch (error) {
        sendJson(socket, {
          type: "error",
          error: error instanceof Error ? error.message : "Failed to process control action."
        });
      }
      return;
    }

    if (parsed.type === "approval") {
      try {
        await handleApproval(deps, socket.__octopusOperator!, sessionId, {
          promptId: parsed.promptId,
          action: parsed.action
        });
      } catch (error) {
        sendJson(socket, {
          type: "error",
          error: error instanceof Error ? error.message : "Failed to process approval action."
        });
      }
      return;
    }

    sendJson(socket, {
      type: "error",
      error: `Unsupported message type: ${String((parsed as { type?: unknown }).type ?? "unknown")}`
    });
  }

  async function authenticateSocket(data: RawData): Promise<void> {
    const parsed = parseMessage(data);
    if (!parsed || parsed.type !== "auth") {
      emitGatewayEvent(deps, "gateway.auth.failed", {
        clientId,
        method: "unknown",
        reason: "First message must be an auth message."
      });
      sendJson(socket, {
        type: "auth.failed",
        reason: "First message must be an auth message."
      });
      detachReason = "auth-failed";
      socket.close();
      return;
    }

    const resolved = resolveOperator(parsed, deps);
    if (!resolved.operator) {
      emitGatewayEvent(deps, "gateway.auth.failed", {
        clientId,
        method: parsed.apiKey ? "api-key" : "session-token",
        reason: "Invalid credentials."
      });
      sendJson(socket, {
        type: "auth.failed",
        reason: "Invalid credentials."
      });
      detachReason = "auth-failed";
      socket.close();
      return;
    }

    if (!resolved.operator.permissions.includes("sessions.read")) {
      emitGatewayEvent(deps, "gateway.auth.failed", {
        clientId,
        method: resolved.operator.authMethod,
        reason: "Missing permission: sessions.read"
      });
      sendJson(socket, {
        type: "auth.failed",
        reason: "Missing permission: sessions.read"
      });
      detachReason = "auth-failed";
      socket.close();
      return;
    }

    const session = await deps.store.loadSession(sessionId);
    if (!session) {
      sendJson(socket, {
        type: "error",
        error: `Unknown session: ${sessionId}`
      });
      detachReason = "unknown-session";
      socket.close();
      return;
    }

    clearTimeout(authTimeout);
    socket.__octopusAuthenticated = true;
    socket.__octopusAuthMethod = resolved.operator.authMethod;
    socket.__octopusOperator = resolved.operator;
    socket.__octopusToken = resolved.token;

    emitGatewayEvent(deps, "gateway.client.connected", {
      clientId,
      authMethod: resolved.operator.authMethod
    });
    emitRemoteEvent(deps, "remote.session.attached", sessionId, {
      clientId,
      sessionId,
      mode: "control"
    });

    sendJson(socket, { type: "auth.ok" });

    const backfill = await readBackfill(deps, sessionId);
    sendJson(socket, {
      type: "backfill",
      events: backfill
    });

    unsubscribe = deps.eventBus.onAny((event) => {
      if (event.sessionId !== sessionId) {
        return;
      }

      const remoteEvent = event as unknown as {
        type: string;
        payload?: {
          promptId?: string;
          description?: string;
          riskLevel?: string;
        };
      };

      if (remoteEvent.type === "remote.approval.requested" && remoteEvent.payload) {
        sendJson(socket, {
          type: "approval.requested",
          promptId: remoteEvent.payload.promptId,
          description: remoteEvent.payload.description,
          riskLevel: remoteEvent.payload.riskLevel
        });
        return;
      }

      sendJson(socket, event);
    });
  }
}

function resolveOperator(message: AuthMessage, deps: RouteDeps): { operator: OperatorContext | null; token?: string } {
  if (message.apiKey) {
    if (!validateApiKey(message.apiKey, deps.config.auth.apiKey)) {
      return { operator: null };
    }

    return {
      operator: {
        operatorId: "operator",
        permissions: [...deps.config.auth.defaultPermissions],
        authMethod: "api-key"
      }
    };
  }

  if (message.token) {
    return {
      operator: deps.tokenStore.validateToken(message.token),
      token: message.token
    };
  }

  return { operator: null };
}

function parseMessage(data: RawData): EventStreamMessage | null {
  try {
    return JSON.parse(rawDataToString(data)) as EventStreamMessage;
  } catch {
    return null;
  }
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}

async function readBackfill(deps: RouteDeps, sessionId: string): Promise<WorkEvent[]> {
  if (!deps.traceReader) {
    return [];
  }

  try {
    const events = await deps.traceReader.read(sessionId);
    const count = deps.config.backfillEventCount ?? 50;
    return events.slice(-count);
  } catch {
    return [];
  }
}

function hasExpiredToken(socket: GatewaySocket, deps: RouteDeps): boolean {
  return socket.__octopusAuthMethod === "session-token"
    && Boolean(socket.__octopusToken)
    && deps.tokenStore.validateToken(socket.__octopusToken!) === null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

function emitGatewayEvent(
  deps: RouteDeps,
  type: "gateway.client.connected" | "gateway.client.disconnected" | "gateway.auth.failed",
  payload: unknown
): void {
  deps.eventBus.emit({
    id: randomUUID(),
    timestamp: new Date(),
    sessionId: "system-gateway",
    goalId: "system-gateway",
    type,
    sourceLayer: "gateway",
    payload
  } as unknown as WorkEvent);
}

function emitRemoteEvent(
  deps: RouteDeps,
  type: "remote.session.attached" | "remote.session.detached",
  sessionId: string,
  payload: unknown
): void {
  deps.eventBus.emit({
    id: randomUUID(),
    timestamp: new Date(),
    sessionId,
    goalId: sessionId,
    type,
    sourceLayer: "gateway",
    payload
  } as unknown as WorkEvent);
}
