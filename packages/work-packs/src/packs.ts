export type { WorkPack } from "./types.js";
import type { WorkPack } from "./types.js";
import { repoHealthCheck } from "./builtin/repo-health-check.js";
import { weeklyReport } from "./builtin/weekly-report.js";
import { dataClean } from "./builtin/data-clean.js";
import { depAudit } from "./builtin/dep-audit.js";

const BUILTIN_PACKS: WorkPack[] = [repoHealthCheck, weeklyReport, dataClean, depAudit];

export function loadBuiltinPacks(): WorkPack[] {
  return [...BUILTIN_PACKS];
}

export function validateParams(pack: WorkPack, params: Record<string, string>): void {
  for (const param of pack.params) {
    if (param.required && !params[param.name] && param.default === undefined) {
      throw new Error(`Missing required parameter: ${param.name} (${param.description})`);
    }
  }
}
