export type McpTransport = "stdio" | "streamable-http" | "sse";

export interface McpServerConfig {
  id: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  toolPolicy?: Record<string, McpToolPolicy>;
  defaultToolPolicy?: "deny" | "allow";
}

export interface McpToolPolicy {
  allowed: boolean;
  securityCategory?: "read" | "patch" | "shell" | "network";
  riskLevel?: "safe" | "consequential" | "dangerous";
}

export interface McpToolDefinition {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  policy: McpToolPolicy;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

export interface McpCallParams {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult {
  content: string;
  isError?: boolean;
}
