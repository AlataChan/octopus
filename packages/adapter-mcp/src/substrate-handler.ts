import { randomUUID } from "node:crypto";

import type { ActionHandler } from "@octopus/exec-substrate";
import type { EventBus, EventPayloadByType, McpEventType, WorkEvent } from "@octopus/observability";
import type { ActionResult } from "@octopus/work-contracts";

import type { McpServerManager } from "./manager.js";
import type { McpSecurityClassifier } from "./security-classifier.js";
import { mcpResultToActionResult, validateAndExtractMcpParams } from "./schema-adapter.js";

export function createMcpActionHandler(
  manager: McpServerManager,
  classifier: McpSecurityClassifier,
  eventBus: EventBus
): ActionHandler {
  return async (action, context) => {
    const params = validateAndExtractMcpParams(action.params);
    const client = manager.getClient(params.serverId);
    if (!client) {
      throw new Error(`MCP server not connected: ${params.serverId}`);
    }

    const tool = client.getToolDefinition(params.toolName);
    if (!tool) {
      throw new Error(`MCP tool not found: ${params.serverId}/${params.toolName}`);
    }

    const toolPolicy = classifier.classifyTool(tool, manager.getServerConfig(params.serverId));
    if (!toolPolicy.allowed) {
      return {
        success: false,
        output: "",
        error: `MCP tool denied by config: ${params.toolName}`
      };
    }

    validateArguments(params.arguments, tool.inputSchema);

    emitMcpEvent(eventBus, context.sessionId, context.goalId, "mcp.tool.called", {
      serverId: params.serverId,
      toolName: params.toolName,
      sessionId: context.sessionId
    });

    const startedAt = Date.now();
    try {
      const result = await client.callTool(params.toolName, params.arguments);
      const actionResult = mcpResultToActionResult(result);
      emitMcpEvent(eventBus, context.sessionId, context.goalId, "mcp.tool.completed", {
        serverId: params.serverId,
        toolName: params.toolName,
        durationMs: Date.now() - startedAt,
        success: actionResult.success
      });
      return actionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitMcpEvent(eventBus, context.sessionId, context.goalId, "mcp.tool.failed", {
        serverId: params.serverId,
        toolName: params.toolName,
        error: message
      });
      return failureResult(message);
    }
  };
}

function validateArguments(argumentsPayload: Record<string, unknown>, inputSchema: Record<string, unknown>): void {
  const required = inputSchema.required;
  if (!Array.isArray(required)) {
    return;
  }

  for (const field of required) {
    if (typeof field !== "string") {
      continue;
    }
    if (!(field in argumentsPayload) || argumentsPayload[field] === undefined) {
      throw new Error(`Missing required MCP argument: ${field}`);
    }
  }
}

function emitMcpEvent<T extends McpEventType>(
  eventBus: EventBus,
  sessionId: string,
  goalId: string,
  type: T,
  payload: EventPayloadByType[T]
): void {
  eventBus.emit({
    id: randomUUID(),
    timestamp: new Date(),
    sessionId,
    goalId,
    type,
    sourceLayer: "mcp",
    payload
  } as Extract<WorkEvent, { type: T }>);
}

function failureResult(error: string): ActionResult {
  return {
    success: false,
    output: "",
    error
  };
}
