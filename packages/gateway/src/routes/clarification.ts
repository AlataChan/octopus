import type { OperatorContext } from "../types.js";
import { HttpError, assertPermission, type RouteDeps } from "./shared.js";

export interface ClarificationBody {
  answer?: string;
}

export async function handleClarification(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string,
  body: ClarificationBody
): Promise<{ ok: true }> {
  assertPermission(operator, "sessions.approve");

  if (typeof body.answer !== "string" || body.answer.trim().length === 0) {
    throw new HttpError(400, "Clarification answer is required.");
  }

  try {
    await deps.engine.resumeBlockedSession(sessionId, {
      kind: "clarification",
      answer: body.answer.trim()
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unknown session")) {
      throw new HttpError(404, error.message);
    }
    if (error instanceof Error && error.message.includes("is not blocked")) {
      throw new HttpError(400, error.message);
    }
    if (error instanceof Error && error.message.includes("No snapshot found")) {
      throw new HttpError(409, error.message);
    }
    throw error;
  }

  return { ok: true };
}
