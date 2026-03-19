import { randomUUID } from "node:crypto";

import type { ActionResult, WorkGoal } from "@octopus/work-contracts";
import type { CompletionCandidate, ContextPayload, SessionSnapshot } from "@octopus/agent-runtime";
import type { RawData, WebSocket, WebSocketServer } from "ws";

import type { WorkEvent } from "@octopus/observability";

import { validateApiKey } from "../auth.js";
import type { RouteDeps } from "../routes/shared.js";
import type { OperatorContext } from "../types.js";

interface AuthMessage {
  type: "auth";
  token?: string;
  apiKey?: string;
}

interface RuntimeBaseMessage {
  type: string;
  requestId?: string;
}

type RuntimeRequestMessage =
  | ({ type: "runtime.initSession"; requestId: string; goal: WorkGoal } & RuntimeBaseMessage)
  | ({ type: "runtime.pauseSession"; requestId: string; sessionId: string } & RuntimeBaseMessage)
  | ({ type: "runtime.resumeSession"; requestId: string; sessionId: string } & RuntimeBaseMessage)
  | ({ type: "runtime.cancelSession"; requestId: string; sessionId: string } & RuntimeBaseMessage)
  | ({ type: "runtime.snapshotSession"; requestId: string; sessionId: string } & RuntimeBaseMessage)
  | ({ type: "runtime.hydrateSession"; requestId: string; snapshot: SessionSnapshot } & RuntimeBaseMessage)
  | ({ type: "runtime.getMetadata"; requestId: string; sessionId: string } & RuntimeBaseMessage)
  | ({ type: "runtime.loadContext"; requestId: string; sessionId: string; context: ContextPayload } & RuntimeBaseMessage)
  | ({ type: "runtime.requestNextAction"; requestId: string; sessionId: string } & RuntimeBaseMessage)
  | ({ type: "runtime.ingestToolResult"; requestId: string; sessionId: string; actionId: string; result: ActionResult } & RuntimeBaseMessage)
  | ({ type: "runtime.signalCompletion"; sessionId: string; candidate: CompletionCandidate } & RuntimeBaseMessage)
  | ({ type: "runtime.signalBlocked"; sessionId: string; reason: string } & RuntimeBaseMessage);

type RuntimeMessage = AuthMessage | RuntimeRequestMessage;

type GatewaySocket = WebSocket & {
  __octopusAuthenticated?: boolean;
  __octopusAuthMethod?: OperatorContext["authMethod"];
  __octopusClientId?: string;
  __octopusOperator?: OperatorContext;
  __octopusToken?: string;
};

export function handleRuntimeProtocolUpgrade(
  _wss: WebSocketServer,
  ws: WebSocket,
  deps: RouteDeps
): void {
  const socket = ws as GatewaySocket;
  const clientId = randomUUID();
  socket.__octopusClientId = clientId;

  if (!deps.config.auth.enableRuntimeProxy) {
    sendJson(socket, {
      type: "error",
      reason: "Runtime proxy not enabled"
    });
    socket.close();
    return;
  }

  let disconnectReason = "client-closed";

  const authTimeout = setTimeout(() => {
    if (socket.__octopusAuthenticated) {
      return;
    }

    sendJson(socket, { type: "auth.timeout" });
    disconnectReason = "auth-timeout";
    socket.close();
  }, deps.config.wsAuthTimeoutMs ?? 5_000);
  authTimeout.unref?.();

  socket.on("message", (data) => {
    void handleMessage(data);
  });

  socket.on("close", () => {
    clearTimeout(authTimeout);

    if (!socket.__octopusAuthenticated) {
      return;
    }

    emitGatewayEvent(deps, "gateway.client.disconnected", {
      clientId,
      reason: disconnectReason
    });
  });

  async function handleMessage(data: RawData): Promise<void> {
    if (!socket.__octopusAuthenticated) {
      authenticateSocket(data);
      return;
    }

    if (hasExpiredToken(socket, deps)) {
      sendJson(socket, { type: "auth.expired" });
      disconnectReason = "token-expired";
      socket.close();
      return;
    }

    const parsed = parseMessage(data);
    if (!parsed) {
      sendRuntimeError(socket, undefined, "Message must be valid JSON.");
      return;
    }

    if (parsed.type === "auth") {
      sendRuntimeError(socket, undefined, "Connection is already authenticated.");
      return;
    }

    try {
      switch (parsed.type) {
        case "runtime.initSession":
          sendJson(socket, {
            type: "runtime.initSession.result",
            requestId: parsed.requestId,
            session: await deps.runtime.initSession(parsed.goal)
          });
          return;
        case "runtime.pauseSession":
          await deps.runtime.pauseSession(parsed.sessionId);
          sendJson(socket, {
            type: "runtime.pauseSession.result",
            requestId: parsed.requestId
          });
          return;
        case "runtime.resumeSession":
          await deps.runtime.resumeSession(parsed.sessionId);
          sendJson(socket, {
            type: "runtime.resumeSession.result",
            requestId: parsed.requestId
          });
          return;
        case "runtime.cancelSession":
          await deps.runtime.cancelSession(parsed.sessionId);
          sendJson(socket, {
            type: "runtime.cancelSession.result",
            requestId: parsed.requestId
          });
          return;
        case "runtime.snapshotSession":
          sendJson(socket, {
            type: "runtime.snapshotSession.result",
            requestId: parsed.requestId,
            snapshot: await deps.runtime.snapshotSession(parsed.sessionId)
          });
          return;
        case "runtime.hydrateSession":
          sendJson(socket, {
            type: "runtime.hydrateSession.result",
            requestId: parsed.requestId,
            session: await deps.runtime.hydrateSession(parsed.snapshot)
          });
          return;
        case "runtime.getMetadata":
          sendJson(socket, {
            type: "runtime.getMetadata.result",
            requestId: parsed.requestId,
            metadata: await deps.runtime.getMetadata(parsed.sessionId)
          });
          return;
        case "runtime.loadContext":
          await deps.runtime.loadContext(parsed.sessionId, parsed.context);
          sendJson(socket, {
            type: "runtime.loadContext.result",
            requestId: parsed.requestId
          });
          return;
        case "runtime.requestNextAction":
          sendJson(socket, {
            type: "runtime.requestNextAction.result",
            requestId: parsed.requestId,
            response: await deps.runtime.requestNextAction(parsed.sessionId)
          });
          return;
        case "runtime.ingestToolResult":
          await deps.runtime.ingestToolResult(parsed.sessionId, parsed.actionId, parsed.result);
          sendJson(socket, {
            type: "runtime.ingestToolResult.result",
            requestId: parsed.requestId
          });
          return;
        case "runtime.signalCompletion":
          deps.runtime.signalCompletion(parsed.sessionId, parsed.candidate);
          return;
        case "runtime.signalBlocked":
          deps.runtime.signalBlocked(parsed.sessionId, parsed.reason);
          return;
      }
    } catch (error) {
      sendRuntimeError(
        socket,
        readRequestId(parsed),
        error instanceof Error ? error.message : "Runtime request failed."
      );
    }
  }

  function authenticateSocket(data: RawData): void {
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
      disconnectReason = "auth-failed";
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
      disconnectReason = "auth-failed";
      socket.close();
      return;
    }

    if (!resolved.operator.permissions.includes("runtime.proxy")) {
      emitGatewayEvent(deps, "gateway.auth.failed", {
        clientId,
        method: resolved.operator.authMethod,
        reason: "Missing permission: runtime.proxy"
      });
      sendJson(socket, {
        type: "auth.failed",
        reason: "Missing permission: runtime.proxy"
      });
      disconnectReason = "auth-failed";
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
    sendJson(socket, { type: "auth.ok" });
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

function parseMessage(data: RawData): RuntimeMessage | null {
  try {
    return JSON.parse(rawDataToString(data)) as RuntimeMessage;
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

function hasExpiredToken(socket: GatewaySocket, deps: RouteDeps): boolean {
  return socket.__octopusAuthMethod === "session-token"
    && Boolean(socket.__octopusToken)
    && deps.tokenStore.validateToken(socket.__octopusToken!) === null;
}

function readRequestId(message: RuntimeRequestMessage): string | undefined {
  const requestId = (message as { requestId?: unknown }).requestId;
  return typeof requestId === "string" ? requestId : undefined;
}

function sendRuntimeError(ws: WebSocket, requestId: string | undefined, error: string): void {
  sendJson(ws, {
    type: "runtime.error",
    requestId,
    error
  });
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
