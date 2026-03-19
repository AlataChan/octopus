import { describe, expect, it } from "vitest";

import { mcpResultToActionResult, validateAndExtractMcpParams } from "../schema-adapter.js";

describe("schema-adapter", () => {
  it("extracts a valid MCP call envelope", () => {
    expect(
      validateAndExtractMcpParams({
        serverId: "filesystem",
        toolName: "read_file",
        arguments: { path: "README.md" }
      })
    ).toEqual({
      serverId: "filesystem",
      toolName: "read_file",
      arguments: { path: "README.md" }
    });
  });

  it("rejects malformed MCP params", () => {
    expect(() => validateAndExtractMcpParams({ serverId: "filesystem", arguments: {} })).toThrow(/toolName/i);
  });

  it("converts MCP results into action results", () => {
    expect(mcpResultToActionResult({ content: "ok" })).toEqual({
      success: true,
      output: "ok"
    });
    expect(mcpResultToActionResult({ content: "boom", isError: true })).toEqual({
      success: false,
      output: "",
      error: "boom"
    });
  });
});
