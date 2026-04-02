import type { OperatorContext } from "../types.js";
import { assertPermission, type RouteDeps } from "./shared.js";

export async function handleStatus(deps: RouteDeps, operator: OperatorContext) {
  assertPermission(operator, "config.read");
  const sessions = await deps.store.listSessions();

  return {
    profile: deps.profileName,
    apiKeyConfigured: deps.config.auth.apiKey.length > 0,
    browserLoginConfigured: (deps.config.auth.users?.length ?? 0) > 0,
    configuredUsers: deps.config.auth.users?.length ?? 0,
    tlsEnabled: Boolean(deps.config.tls),
    trustProxyCIDRs: deps.config.trustProxyCIDRs ?? [],
    host: deps.config.host,
    port: deps.config.port,
    allowRemote: deps.policyResolution.allowRemote ?? false,
    activeSessionCount: sessions.length,
    connectedClients: deps.connectedClientsCount ?? 0,
    traceStreamingAvailable: Boolean(deps.traceReader),
    currentRole: operator.role,
    currentOperator: operator.operatorId
  };
}
