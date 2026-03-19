import type { IncomingMessage, ServerResponse } from "node:http";

import type { AgentRuntime } from "@octopus/agent-runtime";
import type { EventBus, TraceReader } from "@octopus/observability";
import type { SecurityPolicy, SecurityProfileName, PolicyResolution } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import type { WorkEngine } from "@octopus/work-core";

import type { TokenStore } from "../auth.js";
import type { GatewayConfig, GatewayPermission, OperatorContext } from "../types.js";

export interface RouteDeps {
  store: StateStore;
  engine: WorkEngine;
  runtime: AgentRuntime;
  eventBus: EventBus;
  policy: SecurityPolicy;
  tokenStore: TokenStore;
  config: GatewayConfig;
  workspaceRoot: string;
  traceReader?: TraceReader;
  profileName: SecurityProfileName;
  policyResolution: PolicyResolution;
  connectedClientsCount?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function assertPermission(operator: OperatorContext, permission: GatewayPermission): void {
  if (!operator.permissions.includes(permission)) {
    throw new HttpError(403, `Missing permission: ${permission}`);
  }
}

export function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    throw new HttpError(400, "Request body is required.");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}
