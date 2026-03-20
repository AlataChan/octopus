import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { EvalReport, EvalResult } from "./types.js";

export function buildReport(suite: string, results: EvalResult[]): EvalReport {
  const passed = results.filter((r) => r.passed).length;
  return {
    id: `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    suite,
    startedAt: results.length > 0 ? new Date(Date.now() - results.reduce((sum, r) => sum + r.durationMs, 0)).toISOString() : new Date().toISOString(),
    completedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length > 0 ? passed / results.length : 0,
    },
  };
}

export async function saveReport(dataDir: string, report: EvalReport): Promise<void> {
  const evalsDir = join(dataDir, "evals");
  await mkdir(evalsDir, { recursive: true });
  await writeFile(join(evalsDir, `${report.id}.json`), JSON.stringify(report, null, 2), "utf8");
}

export async function loadReport(dataDir: string, reportId?: string): Promise<EvalReport | null> {
  const evalsDir = join(dataDir, "evals");
  try {
    if (reportId) {
      const content = await readFile(join(evalsDir, `${reportId}.json`), "utf8");
      return JSON.parse(content) as EvalReport;
    }
    // Load latest
    const reports = await listReportFiles(evalsDir);
    if (reports.length === 0) return null;
    const content = await readFile(join(evalsDir, `${reports[0]}.json`), "utf8");
    return JSON.parse(content) as EvalReport;
  } catch {
    return null;
  }
}

export async function listReports(
  dataDir: string
): Promise<Array<{ id: string; suite: string; passRate: number; completedAt: string }>> {
  const evalsDir = join(dataDir, "evals");
  const ids = await listReportFiles(evalsDir);
  const results: Array<{ id: string; suite: string; passRate: number; completedAt: string }> = [];

  for (const id of ids) {
    try {
      const content = await readFile(join(evalsDir, `${id}.json`), "utf8");
      const report = JSON.parse(content) as EvalReport;
      results.push({
        id: report.id,
        suite: report.suite,
        passRate: report.summary.passRate,
        completedAt: report.completedAt,
      });
    } catch {
      // skip corrupt report files
    }
  }

  return results;
}

async function listReportFiles(evalsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(evalsDir);
    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => e.replace(".json", ""))
      .sort()
      .reverse(); // newest first
  } catch {
    return [];
  }
}
