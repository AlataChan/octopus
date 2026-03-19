import type { ActionResult } from "@octopus/work-contracts";

import type { McpCallParams, McpToolResult } from "./types.js";

export function validateAndExtractMcpParams(params: Record<string, unknown>): McpCallParams {
  const serverId = params.serverId;
  if (typeof serverId !== "string" || serverId.length === 0) {
    throw new Error("Expected mcp-call params.serverId to be a non-empty string.");
  }

  const toolName = params.toolName;
  if (typeof toolName !== "string" || toolName.length === 0) {
    throw new Error("Expected mcp-call params.toolName to be a non-empty string.");
  }

  const args = params.arguments;
  if (!isRecord(args)) {
    throw new Error("Expected mcp-call params.arguments to be an object.");
  }

  return {
    serverId,
    toolName,
    arguments: args
  };
}

export function mcpResultToActionResult(result: McpToolResult): ActionResult {
  if (result.isError) {
    return {
      success: false,
      output: "",
      error: result.content
    };
  }

  return {
    success: true,
    output: result.content
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
