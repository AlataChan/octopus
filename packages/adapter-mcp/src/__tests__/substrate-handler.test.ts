import { describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import type { Action, ActionResult } from "@octopus/work-contracts";

import { type McpClient } from "../client.js";
import { McpServerManager } from "../manager.js";
import { DefaultMcpSecurityClassifier } from "../security-classifier.js";
import { createMcpActionHandler } from "../substrate-handler.js";
import type { McpServerConfig, McpToolDefinition, McpToolResult } from "../types.js";

describe("createMcpActionHandler", () => {
  it("executes allowed MCP tools and emits MCP events", async () => {
    const eventBus = new EventBus();
    const events: string[] = [];
    eventBus.onAny((event) => {
      events.push(event.type);
    });
    const tool: McpToolDefinition = {
      serverId: "filesystem",
      name: "read_file",
      description: "Read a file",
      inputSchema: {
        type: "object",
        required: ["path"]
      },
      policy: { allowed: true }
    };
    const manager = new McpServerManager();
    await manager.startAll(
      [
        {
          id: "filesystem",
          transport: "stdio",
          defaultToolPolicy: "allow"
        }
      ],
      eventBus,
      () => new FakeMcpClient([tool], { content: "file contents" })
    );
    const handler = createMcpActionHandler(manager, new DefaultMcpSecurityClassifier(), eventBus);

    const result = await handler(createAction("mcp-call", {
      serverId: "filesystem",
      toolName: "read_file",
      arguments: { path: "README.md" }
    }), createContext(eventBus));

    expect(result).toEqual<ActionResult>({
      success: true,
      output: "file contents"
    });
    expect(events).toEqual(["mcp.tool.called", "mcp.tool.completed"]);
    expect(manager.getAllTools()).toHaveLength(1);
  });

  it("returns an error when the tool is denied by config", async () => {
    const eventBus = new EventBus();
    const tool: McpToolDefinition = {
      serverId: "filesystem",
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object" },
      policy: { allowed: true }
    };
    const manager = new McpServerManager();
    await manager.startAll(
      [
        {
          id: "filesystem",
          transport: "stdio",
          toolPolicy: {
            read_file: { allowed: false }
          }
        }
      ],
      eventBus,
      () => new FakeMcpClient([tool], { content: "file contents" })
    );
    const handler = createMcpActionHandler(manager, new DefaultMcpSecurityClassifier(), eventBus);

    const result = await handler(createAction("mcp-call", {
      serverId: "filesystem",
      toolName: "read_file",
      arguments: {}
    }), createContext(eventBus));

    expect(result).toEqual({
      success: false,
      output: "",
      error: "MCP tool denied by config: read_file"
    });
    expect(manager.getAllTools()).toEqual([]);
  });

  it("throws when the MCP server is missing", async () => {
    const eventBus = new EventBus();
    const manager = new McpServerManager();
    const handler = createMcpActionHandler(manager, new DefaultMcpSecurityClassifier(), eventBus);

    await expect(handler(createAction("mcp-call", {
      serverId: "missing",
      toolName: "read_file",
      arguments: {}
    }), createContext(eventBus))).rejects.toThrow(/not connected/i);
  });
});

class FakeMcpClient implements McpClient {
  constructor(
    private readonly tools: McpToolDefinition[],
    private readonly result: McpToolResult
  ) {}

  async connect(_config: McpServerConfig): Promise<void> {}

  async disconnect(): Promise<void> {}

  async listTools(): Promise<McpToolDefinition[]> {
    return this.tools;
  }

  getToolDefinition(name: string): McpToolDefinition | undefined {
    return this.tools.find((tool) => tool.name === name);
  }

  async callTool(_name: string, _args: Record<string, unknown>): Promise<McpToolResult> {
    return this.result;
  }
}

function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return {
    id: `action-${type}`,
    type,
    params,
    createdAt: new Date()
  };
}

function createContext(eventBus: EventBus) {
  return {
    workspaceRoot: process.cwd(),
    sessionId: "session-1",
    goalId: "goal-1",
    eventBus
  };
}
