import type { SkillId } from "./skill.js";
import { isSkillId } from "./skill.js";

export const FORMAT_VERSION = "octopus.v1" as const;

export type MemoryScope = "session" | "agent" | "skill" | "workspace" | "team";
export type MemoryVisibility = "private" | "agent" | "skill" | "workspace" | "team";
export type MemoryKind = "decision" | "fact" | "pattern" | "open_question" | "summary" | "note";
export type PromotionStatus = "candidate" | "active" | "rejected";
export type PromotionConfirmer = "user" | "agent" | "rule";

export type MemorySource =
  | { kind: "trace-event"; sessionId: string; eventId: string }
  | { kind: "artifact"; sessionId: string; path: string; lines?: [number, number] }
  | { kind: "freeform"; reason: string };

export interface MemoryRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  scope: MemoryScope;
  owner: {
    agentId?: string;
    skillId?: SkillId;
    workspaceId?: string;
    teamId?: string;
  };
  visibility: MemoryVisibility;
  content: string;
  kind: MemoryKind;
  tags: string[];
  source: MemorySource;
  promotion: {
    status: PromotionStatus;
    confirmedBy?: PromotionConfirmer;
    confirmedAt?: string;
  };
  injectionStats: {
    timesInjected: number;
    lastInjectedAt?: string;
    positiveOutcomes: number;
    negativeOutcomes: number;
  };
}

export interface MemoryIndexFile {
  version: typeof FORMAT_VERSION;
  skill: SkillId;
  entries: MemoryRecord[];
  statistics?: {
    recordCount?: number;
    updatedAt?: string;
  };
}

const MEMORY_SCOPES = new Set<MemoryScope>(["session", "agent", "skill", "workspace", "team"]);
const MEMORY_VISIBILITIES = new Set<MemoryVisibility>(["private", "agent", "skill", "workspace", "team"]);
const MEMORY_KINDS = new Set<MemoryKind>(["decision", "fact", "pattern", "open_question", "summary", "note"]);
const PROMOTION_STATUSES = new Set<PromotionStatus>(["candidate", "active", "rejected"]);
const PROMOTION_CONFIRMERS = new Set<PromotionConfirmer>(["user", "agent", "rule"]);

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isObject(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isIsoDateString(value.createdAt) &&
    isIsoDateString(value.updatedAt) &&
    typeof value.scope === "string" &&
    MEMORY_SCOPES.has(value.scope as MemoryScope) &&
    isOwner(value.owner) &&
    typeof value.visibility === "string" &&
    MEMORY_VISIBILITIES.has(value.visibility as MemoryVisibility) &&
    isNonEmptyString(value.content) &&
    typeof value.kind === "string" &&
    MEMORY_KINDS.has(value.kind as MemoryKind) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    isMemorySource(value.source) &&
    isPromotion(value.promotion) &&
    isInjectionStats(value.injectionStats)
  );
}

export function isPhaseOneStoredMemoryRecord(value: unknown): value is MemoryRecord {
  return (
    isMemoryRecord(value) &&
    value.scope === "skill" &&
    value.promotion.status === "active" &&
    isSkillId(value.owner.skillId)
  );
}

export function isMemoryIndexFile(value: unknown): value is MemoryIndexFile {
  return (
    isObject(value) &&
    value.version === FORMAT_VERSION &&
    isSkillId(value.skill) &&
    Array.isArray(value.entries) &&
    value.entries.every(isMemoryRecord)
  );
}

function isOwner(value: unknown): value is MemoryRecord["owner"] {
  if (!isObject(value)) {
    return false;
  }
  return (
    optionalString(value.agentId) &&
    (value.skillId === undefined || isSkillId(value.skillId)) &&
    optionalString(value.workspaceId) &&
    optionalString(value.teamId)
  );
}

function isMemorySource(value: unknown): value is MemorySource {
  if (!isObject(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "trace-event") {
    return isNonEmptyString(value.sessionId) && isNonEmptyString(value.eventId);
  }

  if (value.kind === "artifact") {
    return (
      isNonEmptyString(value.sessionId) &&
      isNonEmptyString(value.path) &&
      (value.lines === undefined || isLineTuple(value.lines))
    );
  }

  if (value.kind === "freeform") {
    return isNonEmptyString(value.reason);
  }

  return false;
}

function isPromotion(value: unknown): value is MemoryRecord["promotion"] {
  return (
    isObject(value) &&
    typeof value.status === "string" &&
    PROMOTION_STATUSES.has(value.status as PromotionStatus) &&
    (value.confirmedBy === undefined || PROMOTION_CONFIRMERS.has(value.confirmedBy as PromotionConfirmer)) &&
    (value.confirmedAt === undefined || isIsoDateString(value.confirmedAt))
  );
}

function isInjectionStats(value: unknown): value is MemoryRecord["injectionStats"] {
  return (
    isObject(value) &&
    isNonNegativeNumber(value.timesInjected) &&
    (value.lastInjectedAt === undefined || isIsoDateString(value.lastInjectedAt)) &&
    isNonNegativeNumber(value.positiveOutcomes) &&
    isNonNegativeNumber(value.negativeOutcomes)
  );
}

function isLineTuple(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] > 0 &&
    value[1] >= value[0]
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
