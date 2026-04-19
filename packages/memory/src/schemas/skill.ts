import type { SkillId } from "@octopus/work-contracts";

export type { SkillId };

export const SKILL_IDS = ["dev", "ops", "content", "law", "finance", "molt"] as const satisfies readonly SkillId[];

const SKILL_ID_SET = new Set<string>(SKILL_IDS);

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && SKILL_ID_SET.has(value);
}
