import type { RuntimeResponse } from "@octopus/agent-runtime";
import type { Action, ActionType } from "@octopus/work-contracts";

export function parseRuntimeResponse(raw: string): RuntimeResponse {
  const text = extractJsonBlock(raw);
  const parsed = JSON.parse(text) as unknown;

  if (!isRecord(parsed) || typeof parsed.kind !== "string") {
    throw new Error("Model response is not a valid runtime response.");
  }

  switch (parsed.kind) {
    case "action":
      return {
        kind: "action",
        action: normalizeAction(parsed.action)
      };
    case "completion":
      return {
        kind: "completion",
        evidence: readString(parsed.evidence, "completion.evidence")
      };
    case "blocked":
      return {
        kind: "blocked",
        reason: readString(parsed.reason, "blocked.reason")
      };
    case "clarification":
      return {
        kind: "clarification",
        question: readString(parsed.question, "clarification.question")
      };
    default:
      throw new Error(`Unsupported runtime response kind: ${parsed.kind}`);
  }
}

function extractJsonBlock(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? raw.trim();
}

function normalizeAction(value: unknown): Action {
  if (!isRecord(value)) {
    throw new Error("Action responses must include an action object.");
  }

  const createdAtValue = value.createdAt instanceof Date ? value.createdAt : new Date(readString(value.createdAt, "action.createdAt"));
  if (Number.isNaN(createdAtValue.getTime())) {
    throw new Error("action.createdAt must be a valid ISO timestamp.");
  }

  const params = value.params;
  if (!isRecord(params)) {
    throw new Error("action.params must be an object.");
  }

  return {
    id: readString(value.id, "action.id"),
    type: readActionType(value.type),
    params,
    createdAt: createdAtValue
  };
}

function readActionType(value: unknown): ActionType {
  const actionType = readString(value, "action.type");
  if (!ACTION_TYPES.has(actionType as ActionType)) {
    throw new Error(`Unsupported action type: ${actionType}`);
  }
  return actionType as ActionType;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ACTION_TYPES = new Set<ActionType>(["read", "patch", "shell", "search", "model-call", "mcp-call"]);
