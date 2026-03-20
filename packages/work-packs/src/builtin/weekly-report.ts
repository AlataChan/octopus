import type { WorkPack } from "../types.js";

export const weeklyReport: WorkPack = {
  id: "weekly-report",
  name: "Weekly Report Generator",
  category: "report",
  description: "Generate a work summary report for a date range based on git history and project state.",
  goalTemplate: "Generate a weekly work report covering the period from {{from}} to {{to}}. Analyze git log, changed files, and project state. Produce a structured report as REPORT.md with sections: Summary, Key Changes, Metrics (commits, files changed, contributors), and Next Steps.",
  constraintTemplates: [
    "Only analyze git history within the date range {{from}} to {{to}}",
    "Report must be written as REPORT.md",
    "Use git log and git diff for data — do not fabricate commit information"
  ],
  successCriteriaTemplates: [
    "REPORT.md exists with Summary, Key Changes, and Metrics sections",
    "Report references actual commits from the specified date range"
  ],
  params: [
    { name: "from", description: "Start date (YYYY-MM-DD)", required: true },
    { name: "to", description: "End date (YYYY-MM-DD)", required: true }
  ]
};
