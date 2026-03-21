import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createWorkGoal } from "@octopus/work-contracts";
import type { WorkGoal } from "@octopus/work-contracts";

import type { WorkPack } from "./types.js";

const VALID_CATEGORIES = new Set(["dev", "data", "ops", "report"]);

export async function loadCustomPacks(dir: string): Promise<WorkPack[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const jsonFiles = entries.filter((e) => e.endsWith(".json")).sort();
  const packs: WorkPack[] = [];
  for (const file of jsonFiles) {
    const content = await readFile(join(dir, file), "utf8");
    const data = JSON.parse(content) as unknown;
    packs.push(validateWorkPack(data, file));
  }
  return packs;
}

export function validateWorkPack(data: unknown, source: string): WorkPack {
  if (!data || typeof data !== "object") {
    throw new Error(`Invalid work pack in ${source}: must be a JSON object`);
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.id.trim().length === 0) {
    throw new Error(`Invalid work pack in ${source}: "id" required`);
  }
  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    throw new Error(`Invalid work pack in ${source}: "name" required`);
  }
  if (!VALID_CATEGORIES.has(obj.category as string)) {
    throw new Error(`Invalid work pack in ${source}: "category" must be dev, data, ops, or report`);
  }
  if (typeof obj.goalTemplate !== "string" || obj.goalTemplate.trim().length === 0) {
    throw new Error(`Invalid work pack in ${source}: "goalTemplate" required`);
  }
  if (typeof obj.description !== "string") {
    throw new Error(`Invalid work pack in ${source}: "description" required`);
  }
  if (!Array.isArray(obj.constraintTemplates)) {
    throw new Error(`Invalid work pack in ${source}: "constraintTemplates" must be an array`);
  }
  if (!Array.isArray(obj.successCriteriaTemplates)) {
    throw new Error(`Invalid work pack in ${source}: "successCriteriaTemplates" must be an array`);
  }
  if (!Array.isArray(obj.params)) {
    throw new Error(`Invalid work pack in ${source}: "params" must be an array`);
  }
  for (const param of obj.params) {
    if (!param || typeof param !== "object" || typeof (param as Record<string, unknown>).name !== "string") {
      throw new Error(`Invalid work pack in ${source}: each param must have a "name"`);
    }
  }
  return data as WorkPack;
}

export function resolveGoal(pack: WorkPack, params: Record<string, string>): WorkGoal {
  const resolvedParams: Record<string, string> = {};
  for (const param of pack.params) {
    resolvedParams[param.name] = params[param.name] ?? param.default ?? "";
  }

  const description = replaceTemplateParams(pack.goalTemplate, resolvedParams);
  const constraints = pack.constraintTemplates.map((t) => replaceTemplateParams(t, resolvedParams));
  const successCriteria = pack.successCriteriaTemplates.map((t) => replaceTemplateParams(t, resolvedParams));

  return createWorkGoal({
    description,
    constraints,
    successCriteria,
    namedGoalId: pack.id,
  });
}

function replaceTemplateParams(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? `{{${key}}}`);
}
