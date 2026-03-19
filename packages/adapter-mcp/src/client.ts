import type { EventBus } from "@octopus/observability";

import type { McpServerConfig, McpToolDefinition, McpToolResult } from "./types.js";

export interface McpClient {
  connect(config: McpServerConfig): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  getToolDefinition(name: string): McpToolDefinition | undefined;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export class StubMcpClient implements McpClient {
  constructor(private readonly _eventBus?: EventBus) {}

  async connect(_config: McpServerConfig): Promise<void> {
    throw new Error("MCP SDK not available");
  }

  async disconnect(): Promise<void> {}

  async listTools(): Promise<McpToolDefinition[]> {
    return [];
  }

  getToolDefinition(_name: string): McpToolDefinition | undefined {
    return undefined;
  }

  async callTool(_name: string, _args: Record<string, unknown>): Promise<McpToolResult> {
    throw new Error("MCP SDK not available");
  }
}
