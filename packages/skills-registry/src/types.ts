export interface SkillRegistryEntry {
  id: string;
  name: string;
  version: string;
  tier: string;
  domain: string;
  triggers: string[];
  summary: string;
  depends: string[];
  priority: string;
  platforms: string[];
  bodyPath: string;
  bodySha256: string;
  sourceCommit?: string;
  materializedAt: string;
}

export interface SkillRegistryManifest {
  schemaVersion: 1;
  sourceCommit?: string;
  materializedAt: string;
  entries: SkillRegistryEntry[];
}

export interface LoadSkillRegistryOptions {
  manifestPath?: string;
}

export interface SkillRegistry {
  list(): SkillRegistryEntry[];
  findById(id: string): SkillRegistryEntry | null;
  findByTrigger(query: string): SkillRegistryEntry[];
}
