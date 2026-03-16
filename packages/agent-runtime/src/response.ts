import type { Action } from "@octopus/work-contracts";

import type { RuntimeResponse } from "./types.js";

export function createActionResponse(action: Action): RuntimeResponse {
  return {
    kind: "action",
    action
  };
}

export function createCompletionResponse(evidence: string): RuntimeResponse {
  return {
    kind: "completion",
    evidence
  };
}

export function isRuntimeActionResponse(
  response: RuntimeResponse
): response is Extract<RuntimeResponse, { kind: "action" }> {
  return response.kind === "action";
}

