import type { SessionState, SkillId } from "@octopus/work-contracts";

import type { MemoryKind, MemoryRecord, MemorySource } from "./schemas/memory-record.js";

export type MemoryId = string;

export interface RetrieveInput {
  query: string;
  skill?: SkillId;
  workspaceId?: string;
  limit?: number;
}

export interface MemoryCandidate {
  id: MemoryId;
  record: MemoryRecord;
  content: string;
  kind: MemoryKind;
  score: number;
  tokenCost: number;
}

export interface InjectionBudget {
  tokenBudget: number;
  maxItems: number;
}

export interface MemoryInjectionPlan {
  id: string;
  createdAt: string;
  included: MemoryCandidate[];
  excluded: Array<{
    candidate: MemoryCandidate;
    reason: string;
  }>;
  tokenCost: number;
}

export interface PromoteInput {
  skill: SkillId;
  kind: MemoryKind;
  content: string;
  tags?: string[];
  workspaceId?: string;
  source: MemorySource;
}

export interface InjectionOutcome {
  sessionOutcome: Extract<SessionState, "completed" | "failed" | "cancelled" | "blocked">;
  artifactsProduced: number;
}

export interface MemoryPort {
  retrieve(input: RetrieveInput): Promise<MemoryCandidate[]>;
  planInjection(candidates: MemoryCandidate[], budget: InjectionBudget): Promise<MemoryInjectionPlan>;
  promoteFromSource(input: PromoteInput): Promise<MemoryId>;
  recordInjectionOutcome(planId: string, outcome: InjectionOutcome): Promise<void>;
}
