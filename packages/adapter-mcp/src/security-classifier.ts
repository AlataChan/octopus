import type { McpServerConfig, McpToolDefinition, McpToolPolicy } from "./types.js";

export interface McpSecurityClassifier {
  classifyTool(tool: McpToolDefinition, serverConfig: McpServerConfig): McpToolPolicy;
}

export class DefaultMcpSecurityClassifier implements McpSecurityClassifier {
  classifyTool(tool: McpToolDefinition, serverConfig: McpServerConfig): McpToolPolicy {
    const override = serverConfig.toolPolicy?.[tool.name];
    if (override) {
      return normalizePolicy(override);
    }

    if (serverConfig.defaultToolPolicy === "allow") {
      return {
        allowed: true,
        securityCategory: "network"
      };
    }

    return {
      allowed: false,
      securityCategory: "network"
    };
  }
}

function normalizePolicy(policy: McpToolPolicy): McpToolPolicy {
  return {
    ...policy,
    securityCategory: policy.securityCategory ?? "network"
  };
}
