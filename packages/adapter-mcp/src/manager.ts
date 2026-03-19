import type { EventBus } from "@octopus/observability";

import { DefaultMcpSecurityClassifier, type McpSecurityClassifier } from "./security-classifier.js";
import { StubMcpClient, type McpClient } from "./client.js";
import type { McpServerConfig, McpToolDefinition } from "./types.js";

export type McpClientFactory = (eventBus: EventBus) => McpClient;

export class McpServerManager {
  private readonly clients = new Map<string, McpClient>();
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly tools = new Map<string, McpToolDefinition[]>();

  constructor(private readonly classifier: McpSecurityClassifier = new DefaultMcpSecurityClassifier()) {}

  async startAll(
    configs: McpServerConfig[],
    eventBus: EventBus,
    createClient: McpClientFactory = (bus) => new StubMcpClient(bus)
  ): Promise<void> {
    await this.stopAll();
    for (const config of configs) {
      if (this.configs.has(config.id)) {
        throw new Error(`Duplicate MCP server id: ${config.id}`);
      }
      const client = createClient(eventBus);
      await client.connect(config);
      const tools = await client.listTools();
      this.clients.set(config.id, client);
      this.configs.set(config.id, config);
      this.tools.set(
        config.id,
        tools.map((tool) => ({
          ...tool,
          serverId: config.id
        }))
      );
    }
  }

  async stopAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
    this.configs.clear();
    this.tools.clear();
  }

  getClient(serverId: string): McpClient | undefined {
    return this.clients.get(serverId);
  }

  getServerConfig(serverId: string): McpServerConfig {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`Unknown MCP server: ${serverId}`);
    }
    return config;
  }

  getAllTools(): McpToolDefinition[] {
    const deduped = new Map<string, McpToolDefinition>();
    for (const [serverId, tools] of this.tools.entries()) {
      const config = this.getServerConfig(serverId);
      for (const tool of tools) {
        const policy = this.classifier.classifyTool(tool, config);
        if (policy.allowed) {
          deduped.set(`${serverId}:${tool.name}`, {
            ...tool,
            policy
          });
        }
      }
    }
    return [...deduped.values()];
  }
}
