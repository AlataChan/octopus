import { describe, expect, it } from "vitest";

import {
  FORMAT_VERSION,
  SKILL_IDS,
  isMemoryIndexFile,
  isMemoryRecord,
  isPhaseOneStoredMemoryRecord,
  isSkillId
} from "../index.js";

const baseRecord = {
  id: "mem-1",
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  scope: "skill",
  owner: {
    skillId: "dev"
  },
  visibility: "skill",
  content: "Prefer focused package tests before full repo verification.",
  kind: "pattern",
  tags: ["testing"],
  source: {
    kind: "freeform",
    reason: "manual seed"
  },
  promotion: {
    status: "active",
    confirmedBy: "user",
    confirmedAt: "2026-04-19T00:00:00.000Z"
  },
  injectionStats: {
    timesInjected: 0,
    positiveOutcomes: 0,
    negativeOutcomes: 0
  }
} as const;

describe("memory schemas", () => {
  it("recognizes the hard-coded skill registry", () => {
    expect(SKILL_IDS).toEqual(["dev", "ops", "content", "law", "finance", "molt"]);
    expect(isSkillId("dev")).toBe(true);
    expect(isSkillId("unknown")).toBe(false);
  });

  it("accepts a valid active skill-scoped memory record", () => {
    expect(isMemoryRecord(baseRecord)).toBe(true);
    expect(isPhaseOneStoredMemoryRecord(baseRecord)).toBe(true);
  });

  it("rejects invalid memory records", () => {
    expect(isMemoryRecord({ ...baseRecord, owner: { skillId: "unknown" } })).toBe(false);
    expect(isMemoryRecord({ ...baseRecord, source: undefined })).toBe(false);
    expect(isPhaseOneStoredMemoryRecord({ ...baseRecord, scope: "team" })).toBe(false);
  });

  it("validates index file version and skill", () => {
    expect(isMemoryIndexFile({ version: FORMAT_VERSION, skill: "dev", entries: [baseRecord] })).toBe(true);
    expect(isMemoryIndexFile({ version: "other", skill: "dev", entries: [baseRecord] })).toBe(false);
    expect(isMemoryIndexFile({ version: FORMAT_VERSION, skill: "unknown", entries: [baseRecord] })).toBe(false);
  });
});
