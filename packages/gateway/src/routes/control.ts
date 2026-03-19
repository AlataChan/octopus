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

  const session = await deps.store.loadSession(sessionId);
  if (!session) {
    throw new HttpError(404, `Unknown session: ${sessionId}`);
  }

  if (body.action === "resume") {
    await deps.runtime.resumeSession(sessionId);
    session.state = "active";
  } else {
    await deps.runtime.cancelSession(sessionId);
    session.state = "cancelled";
  }
  session.updatedAt = new Date();
  await deps.store.saveSession(session);

  return { ok: true };
}
