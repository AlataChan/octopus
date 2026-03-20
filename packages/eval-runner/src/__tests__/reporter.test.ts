import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildReport, listReports, loadReport, saveReport } from "../reporter.js";
import type { EvalResult } from "../types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    caseId: "case-1",
    description: "Test case",
    passed: true,
    assertions: [],
    sessionId: "session-1",
    durationMs: 100,
    ...overrides,
  };
}

describe("buildReport", () => {
  it("builds a report with correct summary", () => {
    const results = [makeResult({ passed: true }), makeResult({ caseId: "case-2", passed: false })];
    const report = buildReport("./evals", results);
    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.passRate).toBe(0.5);
    expect(report.id).toMatch(/^run-/);
  });
});

describe("saveReport / loadReport", () => {
  it("saves and loads a report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-reporter-"));
    tempDirs.push(dir);
    const report = buildReport("./evals", [makeResult()]);
    await saveReport(dir, report);
    const loaded = await loadReport(dir, report.id);
    expect(loaded?.id).toBe(report.id);
    expect(loaded?.summary.total).toBe(1);
  });

  it("loads the latest report when no id specified", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-reporter-"));
    tempDirs.push(dir);
    const r1 = buildReport("./evals", [makeResult()]);
    r1.id = "run-2026-01-01";
    await saveReport(dir, r1);
    const r2 = buildReport("./evals", [makeResult(), makeResult({ caseId: "c2" })]);
    r2.id = "run-2026-01-02";
    await saveReport(dir, r2);

    const latest = await loadReport(dir);
    expect(latest?.id).toBe("run-2026-01-02");
  });

  it("returns null when no reports exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-reporter-"));
    tempDirs.push(dir);
    expect(await loadReport(dir)).toBeNull();
  });
});

describe("listReports", () => {
  it("lists reports sorted newest first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-reporter-"));
    tempDirs.push(dir);
    const r1 = buildReport("./evals", [makeResult()]);
    r1.id = "run-a";
    const r2 = buildReport("./evals", [makeResult()]);
    r2.id = "run-b";
    await saveReport(dir, r1);
    await saveReport(dir, r2);

    const list = await listReports(dir);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("run-b");
  });
});
