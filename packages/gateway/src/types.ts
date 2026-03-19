export type GatewayPermission =
  | "sessions.list"
  | "sessions.read"
  | "sessions.control"
  | "sessions.approve"
  | "goals.submit"
  | "runtime.proxy"
  | "config.read";

export interface OperatorContext {
  operatorId: string;
  permissions: GatewayPermission[];
  authMethod: "api-key" | "session-token";
}

export interface GatewayAuthConfig {
  apiKey: string;
  sessionTokenTtlMs?: number;
  defaultPermissions: GatewayPermission[];
  enableRuntimeProxy?: boolean;
}

export interface GatewayConfig {
  port: number;
  host: string;
  workspaceRoot: string;
  tls?: {
    cert: string;
    key: string;
  };
  trustProxyCIDRs?: string[];
  auth: GatewayAuthConfig;
  backfillEventCount?: number;
  wsAuthTimeoutMs?: number;
  tokenSweepIntervalMs?: number;
  allowedOrigins?: string[];
}
