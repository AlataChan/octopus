import { randomUUID } from "node:crypto";

import { createWorkGoal, type BudgetLimits, type SessionState } from "@octopus/work-contracts";

import type { OperatorContext } from "../types.js";
import { HttpError, assertPermission, type RouteDeps } from "./shared.js";

export interface GoalSubmissionBody {
  description?: string;
  constraints?: string[];
  namedGoalId?: string;
  taskTitle?: string;
  budget?: BudgetLimits;
}

export interface GoalSubmissionResponse {
  sessionId: string;
  goalId: string;
  state: SessionState;
}

export async function handleSubmitGoal(
  deps: RouteDeps,
  operator: OperatorContext,
  body: GoalSubmissionBody
): Promise<GoalSubmissionResponse> {
  assertPermission(operator, "goals.submit");
  if (typeof body.description !== "string" || body.description.trim().length === 0) {
    throw new HttpError(400, "Goal description is required.");
  }

  const goal = createWorkGoal({
    id: randomUUID(),
    description: body.description.trim(),
    constraints: body.constraints ?? [],
    namedGoalId: body.namedGoalId
  });
  const taskTitle = typeof body.taskTitle === "string" && body.taskTitle.trim().length > 0
    ? body.taskTitle.trim()
    : undefined;
  const budget = isBudgetLimits(body.budget) ? body.budget : undefined;
  const session = await deps.engine.submitGoal(goal, {
    workspaceRoot: deps.workspaceRoot,
    workspaceId: "default",
    configProfileId: "default",
    createdBy: operator.operatorId,
    ...(taskTitle ? { taskTitle } : {}),
    ...(budget ? { budget } : {})
  });

  deps.eventBus.emit({
    id: randomUUID(),
    timestamp: new Date(),
    sessionId: session.id,
    goalId: goal.id,
    type: "remote.goal.submitted",
    sourceLayer: "gateway",
    payload: {
      clientId: operator.operatorId,
      goalId: goal.id,
      description: goal.description
    }
  } as unknown as import("@octopus/observability").WorkEvent);

  return {
    sessionId: session.id,
    goalId: goal.id,
    state: session.state
  };
}

function isBudgetLimits(value: unknown): value is BudgetLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  return (
    (raw.maxTokens === undefined || typeof raw.maxTokens === "number")
    && (raw.maxCostUsd === undefined || typeof raw.maxCostUsd === "number")
    && (raw.maxWallClockMs === undefined || typeof raw.maxWallClockMs === "number")
  );
}
