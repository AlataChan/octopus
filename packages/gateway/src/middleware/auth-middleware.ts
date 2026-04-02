import type { IncomingMessage } from "node:http";

import { validateApiKey } from "../auth.js";
import type { TokenStore } from "../auth.js";
import type { GatewayAuthConfig, GatewayPermission, OperatorContext } from "../types.js";

export type RequestCredentials = { type: "api-key"; key: string } | { type: "bearer"; token: string };

export function extractCredentials(req: IncomingMessage): RequestCredentials | null {
  const apiKeyHeader = readHeader(req, "x-api-key");
  if (apiKeyHeader) {
    return {
      type: "api-key",
      key: apiKeyHeader
    };
  }

  const authorization = readHeader(req, "authorization");
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    type: "bearer",
    token: match[1]
  };
}

export function authenticateRequest(
  req: IncomingMessage,
  config: GatewayAuthConfig,
  tokenStore: TokenStore
): OperatorContext | null {
  const credentials = extractCredentials(req);
  if (!credentials) {
    return null;
  }

  if (credentials.type === "api-key") {
    if (!validateApiKey(credentials.key, config.apiKey)) {
      return null;
    }

    return {
      operatorId: "operator",
      role: "admin",
      permissions: [...config.defaultPermissions],
      authMethod: "api-key"
    };
  }

  return tokenStore.validateToken(credentials.token);
}

export function requirePermission(operator: OperatorContext, permission: GatewayPermission): boolean {
  return operator.permissions.includes(permission);
}

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}
