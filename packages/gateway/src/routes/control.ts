import type { OperatorContext } from "../types.js";
import { HttpError, assertPermission, type RouteDeps } from "./shared.js";

export interface ControlBody {
  action?: "pause" | "cancel" | "resume";
}

export async function handleControl(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string,
  body: ControlBody
): Promise<{ ok: true }> {
  assertPermission(operator, "sessions.control");

  if (body.action !== "pause" && body.action !== "cancel" && body.action !== "resume") {
    throw new HttpError(400, "Control action must be pause, cancel, or resume.");
  }

  if (body.action === "pause") {
    const session = await deps.engine.pauseSession(sessionId);
    if (!session) {
      throw new HttpError(404, `Unknown session: ${sessionId}`);
    }
    return { ok: true };
  }

  if (body.action === "resume") {
    try {
      await deps.engine.resumeBlockedSession(sessionId, { kind: "operator" });
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

  // cancel
  const session = await deps.store.loadSession(sessionId);
  if (!session) {
    throw new HttpError(404, `Unknown session: ${sessionId}`);
  }
  await deps.runtime.cancelSession(sessionId);
  session.state = "cancelled";
  session.updatedAt = new Date();
  await deps.store.saveSession(session);
  return { ok: true };
}
