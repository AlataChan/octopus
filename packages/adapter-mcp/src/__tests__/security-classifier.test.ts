import { describe, expect, it } from "vitest";

import { DefaultMcpSecurityClassifier } from "../security-classifier.js";
import type { McpServerConfig, McpToolDefinition } from "../types.js";

describe("DefaultMcpSecurityClassifier", () => {
  const classifier = new DefaultMcpSecurityClassifier();
  const tool: McpToolDefinition = {
    serverId: "filesystem",
    name: "read_file",
    description: "Read a file",
    inputSchema: { type: "object" },
    policy: { allowed: false }
  };

  it("prefers per-tool policy over defaults", () => {
    const config: McpServerConfig = {
      id: "filesystem",
      transport: "stdio",
      defaultToolPolicy: "deny",
      toolPolicy: {
        read_file: { allowed: true, securityCategory: "read" }
      }
    };

    expect(classifier.classifyTool(tool, config)).toEqual({
      allowed: true,
      securityCategory: "read"
    });
  });

  it("allows tools when the server default is allow", () => {
    const config: McpServerConfig = {
      id: "filesystem",
      transport: "stdio",
      defaultToolPolicy: "allow"
    };

    expect(classifier.classifyTool(tool, config)).toEqual({
      allowed: true,
      securityCategory: "network"
    });
  });

  it("denies tools by default", () => {
    const config: McpServerConfig = {
      id: "filesystem",
      transport: "stdio"
    };

    expect(classifier.classifyTool(tool, config)).toEqual({
      allowed: false,
      securityCategory: "network"
    });
  });
});
