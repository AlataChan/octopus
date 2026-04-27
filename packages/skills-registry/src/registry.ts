import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { skillRegistryManifestSchema } from "./schemas.js";
import type { LoadSkillRegistryOptions, SkillRegistry, SkillRegistryEntry } from "./types.js";

export function loadSkillRegistry(options: LoadSkillRegistryOptions = {}): SkillRegistry {
  const manifestPath = options.manifestPath ?? defaultManifestPath();
  const entries = readManifestEntries(manifestPath);
  return new InMemorySkillRegistry(entries);
}

class InMemorySkillRegistry implements SkillRegistry {
  private readonly entriesById: Map<string, SkillRegistryEntry>;

  constructor(private readonly entries: SkillRegistryEntry[]) {
    this.entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  }

  list(): SkillRegistryEntry[] {
    return [...this.entries];
  }

  findById(id: string): SkillRegistryEntry | null {
    return this.entriesById.get(id) ?? null;
  }

  findByTrigger(query: string): SkillRegistryEntry[] {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return [];
    }
    return this.entries.filter((entry) =>
      entry.triggers.some((trigger) => {
        const normalizedTrigger = normalizeText(trigger);
        return normalizedQuery.includes(normalizedTrigger);
      })
    );
  }
}

function readManifestEntries(manifestPath: string): SkillRegistryEntry[] {
  try {
    const raw = readFileSync(manifestPath, "utf8");
    return skillRegistryManifestSchema.parse(JSON.parse(raw)).entries;
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

function defaultManifestPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "skills-materialized.json");
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
