import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadBuiltinPacks, validateParams } from "../packs.js";
import { loadCustomPacks, resolveGoal, validateWorkPack } from "../registry.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("loadBuiltinPacks", () => {
  it("returns 4 built-in packs", () => {
    const packs = loadBuiltinPacks();
    expect(packs).toHaveLength(4);
    expect(packs.map((p) => p.id).sort()).toEqual(["data-clean", "dep-audit", "repo-health-check", "weekly-report"]);
  });

  it("each pack has required fields", () => {
    for (const pack of loadBuiltinPacks()) {
      expect(pack.id).toBeTruthy();
      expect(pack.name).toBeTruthy();
      expect(pack.goalTemplate).toBeTruthy();
      expect(pack.constraintTemplates.length).toBeGreaterThan(0);
      expect(pack.successCriteriaTemplates.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveGoal", () => {
  it("replaces template parameters", () => {
    const pack = loadBuiltinPacks().find((p) => p.id === "weekly-report")!;
    const goal = resolveGoal(pack, { from: "2026-03-13", to: "2026-03-20" });
    expect(goal.description).toContain("2026-03-13");
    expect(goal.description).toContain("2026-03-20");
    expect(goal.constraints.some((c) => c.includes("2026-03-13"))).toBe(true);
    expect(goal.namedGoalId).toBe("weekly-report");
  });

  it("uses default values for missing optional params", () => {
    const pack = { ...loadBuiltinPacks()[0], params: [{ name: "x", description: "test", required: false, default: "fallback" }], goalTemplate: "Do {{x}}" };
    const goal = resolveGoal(pack, {});
    expect(goal.description).toBe("Do fallback");
  });
});

describe("validateParams", () => {
  it("passes when all required params provided", () => {
    const pack = loadBuiltinPacks().find((p) => p.id === "weekly-report")!;
    expect(() => validateParams(pack, { from: "2026-01-01", to: "2026-01-07" })).not.toThrow();
  });

  it("throws on missing required param", () => {
    const pack = loadBuiltinPacks().find((p) => p.id === "weekly-report")!;
    expect(() => validateParams(pack, { from: "2026-01-01" })).toThrow("to");
  });
});

describe("validateWorkPack", () => {
  it("rejects missing id", () => {
    expect(() => validateWorkPack({ name: "x", category: "dev", goalTemplate: "t", params: [] }, "test")).toThrow("id");
  });
  it("rejects invalid category", () => {
    expect(() => validateWorkPack({ id: "x", name: "x", category: "invalid", goalTemplate: "t", params: [] }, "test")).toThrow("category");
  });
  it("rejects missing constraintTemplates", () => {
    expect(() => validateWorkPack({ id: "x", name: "x", category: "dev", description: "d", goalTemplate: "t", successCriteriaTemplates: [], params: [] }, "test")).toThrow("constraintTemplates");
  });
  it("rejects missing successCriteriaTemplates", () => {
    expect(() => validateWorkPack({ id: "x", name: "x", category: "dev", description: "d", goalTemplate: "t", constraintTemplates: [], params: [] }, "test")).toThrow("successCriteriaTemplates");
  });
  it("passes valid pack", () => {
    const result = validateWorkPack({ id: "x", name: "x", category: "dev", description: "d", goalTemplate: "t", constraintTemplates: [], successCriteriaTemplates: [], params: [] }, "test");
    expect(result.id).toBe("x");
  });
});

describe("loadCustomPacks", () => {
  it("loads JSON packs from directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-packs-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "custom.json"), JSON.stringify({
      id: "custom-1", name: "Custom", category: "dev", description: "d", goalTemplate: "Do stuff", constraintTemplates: [], successCriteriaTemplates: [], params: []
    }), "utf8");
    const packs = await loadCustomPacks(dir);
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe("custom-1");
  });

  it("returns empty for nonexistent directory", async () => {
    expect(await loadCustomPacks("/nonexistent/path")).toEqual([]);
  });

  it("throws on malformed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-packs-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "bad.json"), "not json", "utf8");
    await expect(loadCustomPacks(dir)).rejects.toThrow();
  });
});
