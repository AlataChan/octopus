import { describe, expect, it } from "vitest";

import { parseRuntimeResponse } from "../response-parser.js";

describe("parseRuntimeResponse", () => {
  it("parses plain JSON responses", () => {
    const response = parseRuntimeResponse(`{"kind":"completion","evidence":"done"}`);

    expect(response).toEqual({
      kind: "completion",
      evidence: "done"
    });
  });

  it("parses fenced JSON responses", () => {
    const response = parseRuntimeResponse(
      "```json\n{\"kind\":\"blocked\",\"reason\":\"Need approval\"}\n```"
    );

    expect(response).toEqual({
      kind: "blocked",
      reason: "Need approval"
    });
  });

  it("rejects action responses that omit the action payload", () => {
    expect(() => parseRuntimeResponse(`{"kind":"action"}`)).toThrow(/action/i);
  });

  it("normalizes action timestamps into Date instances", () => {
    const response = parseRuntimeResponse(
      '{"kind":"action","action":{"id":"action-1","type":"read","params":{"path":"README.md","encoding":"utf8"},"createdAt":"2026-03-16T00:00:00.000Z"}}'
    );

    expect(response.kind).toBe("action");
    if (response.kind !== "action") {
      throw new Error("Expected action response.");
    }
    expect(response.action.createdAt).toBeInstanceOf(Date);
  });

  it("accepts mcp-call actions", () => {
    const response = parseRuntimeResponse(
      '{"kind":"action","action":{"id":"action-1","type":"mcp-call","params":{"serverId":"filesystem","toolName":"read_file","arguments":{"path":"README.md"}},"createdAt":"2026-03-16T00:00:00.000Z"}}'
    );

    expect(response.kind).toBe("action");
    if (response.kind !== "action") {
      throw new Error("Expected action response.");
    }
    expect(response.action.type).toBe("mcp-call");
  });
});
