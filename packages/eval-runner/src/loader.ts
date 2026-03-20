import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { EvalCase } from "./types.js";

const VALID_ASSERTION_TYPES = new Set([
  "file-exists", "file-contains", "file-matches",
  "shell-passes", "session-completed", "no-blocked", "artifact-count"
]);

export async function loadEvalSuite(suiteDir: string): Promise<EvalCase[]> {
  const entries = await readdir(suiteDir);
  const jsonFiles = entries.filter((entry) => entry.endsWith(".json")).sort();

  if (jsonFiles.length === 0) {
    return [];
  }

  const cases: EvalCase[] = [];

  for (const file of jsonFiles) {
    const content = await readFile(join(suiteDir, file), "utf8");
    const parsed = JSON.parse(content) as unknown;
    const evalCase = validateEvalCase(parsed, file);
    cases.push(evalCase);
  }

  return cases;
}

export function validateEvalCase(data: unknown, source: string): EvalCase {
  if (!data || typeof data !== "object") {
    throw new Error(`Invalid eval case in ${source}: must be a JSON object`);
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== "string" || obj.id.trim().length === 0) {
    throw new Error(`Invalid eval case in ${source}: "id" must be a non-empty string`);
  }
  if (typeof obj.description !== "string") {
    throw new Error(`Invalid eval case in ${source}: "description" must be a string`);
  }
  if (!obj.goal || typeof obj.goal !== "object") {
    throw new Error(`Invalid eval case in ${source}: "goal" must be an object`);
  }

  const goal = obj.goal as Record<string, unknown>;
  if (typeof goal.description !== "string" || goal.description.trim().length === 0) {
    throw new Error(`Invalid eval case in ${source}: "goal.description" must be a non-empty string`);
  }

  if (!Array.isArray(obj.assertions) || obj.assertions.length === 0) {
    throw new Error(`Invalid eval case in ${source}: "assertions" must be a non-empty array`);
  }

  for (const assertion of obj.assertions) {
    if (!assertion || typeof assertion !== "object" || !VALID_ASSERTION_TYPES.has((assertion as { type?: string }).type ?? "")) {
      throw new Error(`Invalid eval case in ${source}: invalid assertion type "${(assertion as { type?: string }).type ?? "unknown"}"`);
    }
    validateAssertionFields(assertion as Record<string, unknown>, source);
  }

  // Validate fixture paths
  if (obj.fixture && typeof obj.fixture === "object") {
    const fixture = obj.fixture as { files?: Record<string, string> };
    if (fixture.files) {
      for (const filePath of Object.keys(fixture.files)) {
        if (filePath.includes("..") || filePath.startsWith("/")) {
          throw new Error(`Invalid eval case in ${source}: fixture path "${filePath}" is not allowed (no .. or absolute paths)`);
        }
      }
    }
  }

  return data as EvalCase;
}

function validateAssertionFields(assertion: Record<string, unknown>, source: string): void {
  const type = assertion.type as string;
  switch (type) {
    case "file-exists":
    case "file-contains":
    case "file-matches":
      if (typeof assertion.path !== "string" || assertion.path.trim().length === 0) {
        throw new Error(`Invalid eval case in ${source}: "${type}" assertion requires a non-empty "path"`);
      }
      if (type === "file-contains" && typeof assertion.pattern !== "string") {
        throw new Error(`Invalid eval case in ${source}: "file-contains" assertion requires a "pattern" string`);
      }
      if (type === "file-matches" && typeof assertion.expected !== "string") {
        throw new Error(`Invalid eval case in ${source}: "file-matches" assertion requires an "expected" string`);
      }
      break;
    case "shell-passes":
      if (typeof assertion.command !== "string" || assertion.command.trim().length === 0) {
        throw new Error(`Invalid eval case in ${source}: "shell-passes" assertion requires a non-empty "command"`);
      }
      break;
    case "artifact-count":
      if (typeof assertion.min !== "number" || assertion.min < 0) {
        throw new Error(`Invalid eval case in ${source}: "artifact-count" assertion requires a non-negative "min"`);
      }
      break;
  }
}
