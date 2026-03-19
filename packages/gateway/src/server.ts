import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createTlsServer, type Server as HttpsServer } from "node:https";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

import type { AgentRuntime } from "@octopus/agent-runtime";
import type { EventBus, TraceReader } from "@octopus/observability";
import type { PolicyResolution, SecurityPolicy, SecurityProfileName } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import type { WorkEngine } from "@octopus/work-core";

import { TokenStore } from "./auth.js";
import { authenticateRequest } from "./middleware/auth-middleware.js";
import { validateOrigin } from "./middleware/origin-guard.js";
import { isLoopback, isSecureConnection } from "./middleware/tls-guard.js";
import { handleApproval } from "./routes/approval.js";
import { handleGetArtifactContent } from "./routes/artifacts.js";
import { handleMintToken } from "./routes/auth-routes.js";
import { handleControl } from "./routes/control.js";
import { handleSubmitGoal } from "./routes/goals.js";
import { handleHealth } from "./routes/health.js";
import { HttpError, readJsonBody, writeJson, type RouteDeps } from "./routes/shared.js";
import { handleGetEvents, handleGetSession, handleListSessions, handleListSnapshots } from "./routes/sessions.js";
import { handleStatus } from "./routes/status.js";
import type { GatewayConfig } from "./types.js";
import { handleEventStreamUpgrade } from "./ws/event-stream.js";
import { handleRuntimeProtocolUpgrade } from "./ws/runtime-protocol.js";

type GatewaySocket = WebSocket & {
  __octopusAuthMethod?: "api-key" | "session-token";
  __octopusToken?: string;
};

export class GatewayServer {
  private readonly tokenStore: TokenStore;
  private server?: HttpServer | HttpsServer;
  private eventWss?: WebSocketServer;
  private runtimeWss?: WebSocketServer;
  private readonly connectedSockets = new Set<GatewaySocket>();
  private readonly startedAt = Date.now();
  private readonly traceReader?: TraceReader;
  private wsSweepTimer?: NodeJS.Timeout;

  constructor(
    private config: GatewayConfig,
    private engine: WorkEngine,
    private runtime: AgentRuntime,
    private store: StateStore,
    private eventBus: EventBus,
    private policy: SecurityPolicy,
    private profileName: SecurityProfileName,
    private policyResolution: PolicyResolution
  ) {
    this.tokenStore = new TokenStore(config.auth.sessionTokenTtlMs ?? 3_600_000);
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.validateProfile();
    this.server = this.createNodeServer();
    this.attachWebSocketServers(this.server);
    this.tokenStore.startSweep(this.config.tokenSweepIntervalMs ?? 30_000);
    this.startWebSocketSweep();

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.config.port, this.config.host, () => {
        this.server!.off("error", reject);
        const address = this.server!.address();
        if (address && typeof address === "object") {
          this.config.port = address.port;
        }
        this.emitGatewayEvent("gateway.started", {
          port: this.config.port,
          host: this.config.host,
          tlsEnabled: Boolean(this.config.tls)
        });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.tokenStore.stopSweep();
    this.stopWebSocketSweep();
    if (!this.server) {
      return;
    }

    for (const socket of this.connectedSockets) {
      socket.close();
    }

    await Promise.all([this.closeWebSocketServer(this.eventWss), this.closeWebSocketServer(this.runtimeWss)]);
    this.eventWss = undefined;
    this.runtimeWss = undefined;

    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.emitGatewayEvent("gateway.stopped", { reason: "shutdown" });
  }

  get origin(): string | null {
    if (!this.server) {
      return null;
    }

    const address = this.server.address();
    if (!address || typeof address === "string") {
      return null;
    }

    const protocol = this.config.tls ? "https" : "http";
    return `${protocol}://${address.address}:${address.port}`;
  }

  private createNodeServer(): HttpServer | HttpsServer {
    const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
      void this.handleRequest(req, res);
    };

    if (this.config.tls) {
      return createTlsServer(
        {
          cert: readFileSync(this.config.tls.cert, "utf8"),
          key: readFileSync(this.config.tls.key, "utf8")
        },
        requestHandler
      );
    }

    return createServer(requestHandler);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!isSecureConnection(req, this.config)) {
        throw new HttpError(400, "TLS required for this connection.");
      }

      const url = new URL(req.url ?? "/", this.baseUrl(req));
      const method = req.method ?? "GET";
      const deps = this.createRouteDeps();

      if (method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, await handleHealth(deps));
        return;
      }

      const operator = authenticateRequest(req, this.config.auth, this.tokenStore);
      if (!operator) {
        throw new HttpError(401, "Authentication required.");
      }

      if (method === "POST" && url.pathname === "/auth/token") {
        writeJson(res, 200, await handleMintToken(deps, operator, await readOptionalJsonBody(req)));
        return;
      }

      if (method === "GET" && url.pathname === "/api/sessions") {
        writeJson(res, 200, await handleListSessions(deps, operator));
        return;
      }

      if (method === "POST" && url.pathname === "/api/goals") {
        writeJson(res, 200, await handleSubmitGoal(deps, operator, await readJsonBody(req)));
        return;
      }

      if (method === "GET" && url.pathname === "/api/status") {
        writeJson(res, 200, await handleStatus(deps, operator));
        return;
      }

      const snapshotsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/snapshots$/);
      if (method === "GET" && snapshotsMatch) {
        writeJson(res, 200, await handleListSnapshots(deps, operator, decodeURIComponent(snapshotsMatch[1])));
        return;
      }

      const eventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
      if (method === "GET" && eventsMatch) {
        writeJson(res, 200, await handleGetEvents(deps, operator, decodeURIComponent(eventsMatch[1])));
        return;
      }

      const artifactContentMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/artifacts\/content$/);
      if (method === "GET" && artifactContentMatch) {
        writeJson(
          res,
          200,
          await handleGetArtifactContent(
            deps,
            operator,
            decodeURIComponent(artifactContentMatch[1]),
            url.searchParams.get("path")
          )
        );
        return;
      }

      const controlMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/control$/);
      if (method === "POST" && controlMatch) {
        writeJson(
          res,
          200,
          await handleControl(deps, operator, decodeURIComponent(controlMatch[1]), await readJsonBody(req))
        );
        return;
      }

      const approvalMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/approval$/);
      if (method === "POST" && approvalMatch) {
        writeJson(
          res,
          200,
          await handleApproval(deps, operator, decodeURIComponent(approvalMatch[1]), await readJsonBody(req))
        );
        return;
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (method === "GET" && sessionMatch) {
        writeJson(res, 200, await handleGetSession(deps, operator, decodeURIComponent(sessionMatch[1])));
        return;
      }

      throw new HttpError(404, `Unknown route: ${method} ${url.pathname}`);
    } catch (error) {
      this.writeError(res, error);
    }
  }

  private createRouteDeps(): RouteDeps {
    return {
      store: this.store,
      engine: this.engine,
      runtime: this.runtime,
      eventBus: this.eventBus,
      policy: this.policy,
      tokenStore: this.tokenStore,
      config: this.config,
      workspaceRoot: this.config.workspaceRoot,
      traceReader: this.traceReader,
      profileName: this.profileName,
      policyResolution: this.policyResolution,
      connectedClientsCount: this.connectedSockets.size
    };
  }

  private baseUrl(req: IncomingMessage): string {
    const protocol = this.config.tls ? "https" : "http";
    const host = req.headers.host ?? `${this.config.host}:${this.config.port}`;
    return `${protocol}://${host}`;
  }

  private writeError(res: ServerResponse, error: unknown): void {
    if (error instanceof HttpError) {
      writeJson(res, error.statusCode, { error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error.";
    writeJson(res, 500, { error: message });
  }

  private validateProfile(): void {
    if (this.profileName === "safe-local") {
      throw new Error("Gateway requires 'vibe' or 'platform' profile.");
    }

    if (this.profileName === "vibe" && !isLoopback(this.config.host)) {
      this.config.host = "127.0.0.1";
    }

    if (this.profileName === "platform" && !this.policyResolution.allowRemote) {
      throw new Error("Gateway with platform profile requires allowRemote: true in policy file.");
    }

    if (!isLoopback(this.config.host) && !this.config.tls && !this.config.trustProxyCIDRs?.length) {
      throw new Error("TLS required for non-loopback gateway exposure.");
    }
  }

  private attachWebSocketServers(server: HttpServer | HttpsServer): void {
    this.eventWss = new WebSocketServer({ noServer: true });
    this.runtimeWss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      if (!isSecureConnection(req, this.config)) {
        socket.destroy();
        return;
      }

      const origin = this.readHeader(req, "origin");
      if (origin && !validateOrigin(origin, this.config)) {
        socket.destroy();
        return;
      }

      const url = new URL(req.url ?? "/", this.baseUrl(req));
      const eventMatch = url.pathname.match(/^\/ws\/sessions\/([^/]+)\/events$/);
      if (eventMatch) {
        this.eventWss!.handleUpgrade(req, socket, head, (ws) => {
          this.trackSocket(ws as GatewaySocket);
          handleEventStreamUpgrade(this.eventWss!, ws, decodeURIComponent(eventMatch[1]), this.createRouteDeps());
        });
        return;
      }

      if (url.pathname === "/ws/runtime") {
        if (!this.config.auth.enableRuntimeProxy) {
          socket.destroy();
          return;
        }

        this.runtimeWss!.handleUpgrade(req, socket, head, (ws) => {
          this.trackSocket(ws as GatewaySocket);
          handleRuntimeProtocolUpgrade(this.runtimeWss!, ws, this.createRouteDeps());
        });
        return;
      }

      socket.destroy();
    });
  }

  private trackSocket(socket: GatewaySocket): void {
    this.connectedSockets.add(socket);
    socket.on("close", () => {
      this.connectedSockets.delete(socket);
    });
  }

  private startWebSocketSweep(): void {
    this.stopWebSocketSweep();
    this.wsSweepTimer = setInterval(() => {
      for (const socket of this.connectedSockets) {
        if (socket.__octopusAuthMethod !== "session-token" || !socket.__octopusToken) {
          continue;
        }

        if (this.tokenStore.validateToken(socket.__octopusToken) !== null) {
          continue;
        }

        socket.send(JSON.stringify({ type: "auth.expired" }));
        socket.close();
      }
    }, this.config.tokenSweepIntervalMs ?? 30_000);
    this.wsSweepTimer.unref?.();
  }

  private stopWebSocketSweep(): void {
    if (this.wsSweepTimer) {
      clearInterval(this.wsSweepTimer);
      this.wsSweepTimer = undefined;
    }
  }

  private closeWebSocketServer(server: WebSocketServer | undefined): Promise<void> {
    if (!server) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  private readHeader(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name];
    if (Array.isArray(value)) {
      return value[0];
    }

    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private emitGatewayEvent(type: "gateway.started" | "gateway.stopped", payload: unknown): void {
    this.eventBus.emit({
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: "system-gateway",
      goalId: "system-gateway",
      type,
      sourceLayer: "gateway",
      payload
    } as unknown as import("@octopus/observability").WorkEvent);
  }
}

async function readOptionalJsonBody(req: IncomingMessage): Promise<unknown | undefined> {
  try {
    return await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpError && error.message === "Request body is required.") {
      return undefined;
    }
    throw error;
  }
}
