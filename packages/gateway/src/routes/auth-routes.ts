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
    permissions
  );

  return { token, expiresAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
