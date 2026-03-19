import { randomUUID } from "node:crypto";

import type { OperatorContext } from "../types.js";
import { HttpError, assertPermission, type RouteDeps } from "./shared.js";

export interface ApprovalBody {
  promptId?: string;
  action?: "approve" | "deny";
}

export async function handleApproval(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string,
  body: ApprovalBody
): Promise<{ ok: true }> {
  assertPermission(operator, "sessions.approve");

  if (typeof body.promptId !== "string" || body.promptId.length === 0) {
    throw new HttpError(400, "promptId is required.");
  }
  if (body.action !== "approve" && body.action !== "deny") {
    throw new HttpError(400, "Approval action must be approve or deny.");
  }

  if (body.action === "approve") {
    deps.policy.approveForSession(body.promptId);
  }

  deps.eventBus.emit({
    id: randomUUID(),
    timestamp: new Date(),
    sessionId,
    goalId: sessionId,
    type: "remote.approval.resolved",
    sourceLayer: "gateway",
    payload: {
      sessionId,
      promptId: body.promptId,
      action: body.action,
      clientId: operator.operatorId
    }
  } as unknown as import("@octopus/observability").WorkEvent);

  return { ok: true };
}
