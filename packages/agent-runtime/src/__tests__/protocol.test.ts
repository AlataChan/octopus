import { describe, expect, it } from "vitest";

import { createActionResponse, createCompletionResponse, isRuntimeActionResponse } from "../response.js";

describe("runtime response helpers", () => {
  it("creates an action response and narrows it", () => {
    const response = createActionResponse({
      id: "action-1",
      type: "read",
      params: { path: "README.md" },
      createdAt: new Date("2026-03-16T00:00:00.000Z")
    });

    expect(response.kind).toBe("action");
    expect(isRuntimeActionResponse(response)).toBe(true);
  });

  it("creates a completion response", () => {
    const response = createCompletionResponse("Artifacts persisted");

    expect(response).toEqual({
      kind: "completion",
      evidence: "Artifacts persisted"
    });
    expect(isRuntimeActionResponse(response)).toBe(false);
  });
});
