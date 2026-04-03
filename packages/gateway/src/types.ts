export type GatewayPermission =
  | "sessions.list"
  | "sessions.read"
  | "sessions.control"
  | "sessions.approve"
  | "goals.submit"
  | "runtime.proxy"
  | "config.read";

export type GatewayRole = "viewer" | "operator" | "admin";

export interface GatewayUserAccount {
  username: string;
  passwordHash: string;
  role: GatewayRole;
}

export interface SystemRuntimeConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface SystemAuthConfig {
  gatewayApiKey: string;
  users: GatewayUserAccount[];
}

export interface SystemMeta {
  initialized: boolean;
  initializedAt: string;
  initializedBy: string;
  schemaVersion: number;
}

export interface SystemConfig {
  runtime: SystemRuntimeConfig;
  auth: SystemAuthConfig;
  meta: SystemMeta;
}

export interface OperatorContext {
  operatorId: string;
  role: GatewayRole;
  permissions: GatewayPermission[];
  authMethod: "api-key" | "session-token";
}

export interface GatewayAuthConfig {
  apiKey: string;
  users?: GatewayUserAccount[];
  sessionTokenTtlMs?: number;
  defaultPermissions: GatewayPermission[];
  enableRuntimeProxy?: boolean;
}

export interface GatewayConfig {
  port: number;
  host: string;
  workspaceRoot: string;
  systemConfigDir?: string;
  setupToken?: string;
  setupMode?: boolean;
  tls?: {
    cert: string;
    key: string;
  };
  trustProxyCIDRs?: string[];
  allowInsecureTrustedProxy?: boolean;
  auth: GatewayAuthConfig;
  backfillEventCount?: number;
  wsAuthTimeoutMs?: number;
  tokenSweepIntervalMs?: number;
  allowedOrigins?: string[];
}
