import { randomUUID } from "node:crypto";

import type { SkillId, WorkGoal, WorkSession } from "./types.js";

export interface CreateWorkGoalInput {
  id?: string;
  description: string;
  constraints?: string[];
  successCriteria?: string[];
  createdAt?: Date;
  namedGoalId?: string;
}

export function createWorkGoal(input: CreateWorkGoalInput): WorkGoal {
  return {
    id: input.id ?? randomUUID(),
    description: input.description,
    constraints: input.constraints ?? [],
    successCriteria: input.successCriteria ?? [],
    createdAt: input.createdAt ?? new Date(),
    namedGoalId: input.namedGoalId
  };
}

export interface CreateWorkSessionInput {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  workspaceId?: string;
  configProfileId?: string;
  createdBy?: string;
  taskTitle?: string;
  skillContext?: SkillId;
}

export function createWorkSession(
  goal: WorkGoal,
  input: CreateWorkSessionInput = {}
): WorkSession {
  const createdAt = input.createdAt ?? new Date();

  return {
    id: input.id ?? randomUUID(),
    goalId: goal.id,
    workspaceId: input.workspaceId ?? "default",
    configProfileId: input.configProfileId ?? "default",
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    ...(input.taskTitle ? { taskTitle: input.taskTitle } : {}),
    ...(input.skillContext ? { skillContext: input.skillContext } : {}),
    injectionPlanIds: [],
    namedGoalId: goal.namedGoalId,
    state: "created",
    items: [],
    observations: [],
    artifacts: [],
    transitions: [],
    createdAt,
    updatedAt: input.updatedAt ?? createdAt
  };
}
