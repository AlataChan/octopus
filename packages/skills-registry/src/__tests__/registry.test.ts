import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSkillRegistry } from "../registry.js";
import { skillRegistryEntrySchema } from "../schemas.js";
import type { SkillRegistryManifest } from "../types.js";

describe("loadSkillRegistry", () => {
  it("returns an empty registry when no materialized manifest exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-skills-empty-"));

    const registry = loadSkillRegistry({
      manifestPath: join(dir, "skills-materialized.json"),
    });

    expect(registry.list()).toEqual([]);
    expect(registry.findById("core/code/review")).toBeNull();
    expect(registry.findByTrigger("please run a plan review")).toEqual([]);
  });

  it("loads materialized entries and supports id and trigger lookups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-skills-registry-"));
    const manifestPath = join(dir, "skills-materialized.json");
    const entry = {
      id: "core/code/plan-review",
      name: "plan-review",
      version: "1.0.0",
      tier: "core",
      domain: "code",
      triggers: ["plan review", "design review"],
      summary: "Review implementation plans for correctness and safety.",
      depends: [],
      priority: "high",
      platforms: ["codex"],
      bodyPath: "bundle/core/code/plan-review/skill.md",
      bodySha256: "a".repeat(64),
      sourceCommit: "abc123",
      materializedAt: "2026-04-27T00:00:00.000Z",
    } satisfies SkillRegistryManifest["entries"][number];
    const manifest: SkillRegistryManifest = {
      schemaVersion: 1,
      sourceCommit: "abc123",
      materializedAt: "2026-04-27T00:00:00.000Z",
      entries: [entry],
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const registry = loadSkillRegistry({ manifestPath });

    expect(registry.list()).toEqual([entry]);
    expect(registry.findById("core/code/plan-review")).toEqual(entry);
    expect(registry.findByTrigger("Can you do a DESIGN REVIEW?")).toEqual([entry]);
    expect(registry.findByTrigger("design")).toEqual([]);
  });
});

describe("skillRegistryEntrySchema", () => {
  it("accepts uppercase sha256 hex strings", () => {
    const result = skillRegistryEntrySchema.parse({
      id: "core/code/plan-review",
      name: "plan-review",
      version: "1.0.0",
      tier: "core",
      domain: "code",
      triggers: ["plan review"],
      summary: "Review implementation plans.",
      depends: [],
      priority: "high",
      platforms: ["codex"],
      bodyPath: "bundle/core/code/plan-review/skill.md",
      bodySha256: "A".repeat(64),
      materializedAt: "2026-04-27T00:00:00.000Z",
    });

    expect(result.bodySha256).toBe("A".repeat(64));
  });
});
