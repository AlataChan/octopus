import { authenticateUser, getPermissionsForRole } from "../auth.js";
import type { GatewayPermission, OperatorContext } from "../types.js";
import { HttpError, type RouteDeps } from "./shared.js";

const GATEWAY_PERMISSIONS: ReadonlySet<GatewayPermission> = new Set([
  "sessions.list",
  "sessions.read",
  "sessions.control",
  "sessions.approve",
  "goals.submit",
  "runtime.proxy",
  "config.read"
]);

export async function handleMintToken(deps: RouteDeps, operator: OperatorContext, body?: unknown) {
  if (operator.authMethod !== "api-key") {
    throw new HttpError(403, "Token minting requires API key authentication.");
  }

  const requestedPermissions =
    isRecord(body) && isPermissionArray(body.permissions) ? body.permissions : null;
  const permissions = requestedPermissions
    ? requestedPermissions.filter((permission) => deps.config.auth.defaultPermissions.includes(permission))
    : deps.config.auth.defaultPermissions;

  const { token, expiresAt } = deps.tokenStore.mintToken(
    operator.operatorId,
    permissions,
    operator.role
  );

  return { token, expiresAt };
}

export async function handleLogin(deps: RouteDeps, body?: unknown) {
  if (!deps.config.auth.users || deps.config.auth.users.length === 0) {
    throw new HttpError(503, "Browser login is not configured.");
  }

  if (!isRecord(body)) {
    throw new HttpError(400, "Request body must include username and password.");
  }

  const username = readTrimmedNonEmptyString(body.username);
  const password = readNonEmptyPassword(body.password);
  if (!username || !password) {
    throw new HttpError(400, "Request body must include username and password.");
  }

  const account = await authenticateUser(deps.config.auth.users, username, password);
  if (!account) {
    throw new HttpError(401, "Invalid username or password.");
  }

  const { token, expiresAt } = deps.tokenStore.mintToken(
    account.username,
    getPermissionsForRole(account.role),
    account.role
  );

  return {
    token,
    expiresAt,
    role: account.role,
    username: account.username
  };
}

export async function handleSessionStatus(deps: RouteDeps, token: string | undefined) {
  if (!token) {
    return {
      authenticated: false as const
    };
  }

  const operator = deps.tokenStore.validateToken(token);
  if (!operator || operator.authMethod !== "session-token") {
    return {
      authenticated: false as const
    };
  }

  return {
    authenticated: true as const,
    role: operator.role,
    username: operator.operatorId
  };
}

export async function handleLogout(
  deps: RouteDeps,
  operator: OperatorContext,
  token: string | undefined
) {
  if (operator.authMethod !== "session-token" || !token) {
    throw new HttpError(400, "Logout requires a browser session token.");
  }

  deps.tokenStore.revokeToken(token);
  return {
    revoked: true
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNonEmptyPassword(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isPermissionArray(value: unknown): value is GatewayPermission[] {
  return (
    Array.isArray(value) &&
    value.every(
      (permission) =>
        typeof permission === "string" && GATEWAY_PERMISSIONS.has(permission as GatewayPermission)
    )
  );
}
