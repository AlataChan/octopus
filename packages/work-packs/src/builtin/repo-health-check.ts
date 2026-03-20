import type { WorkPack } from "../types.js";

export const repoHealthCheck: WorkPack = {
  id: "repo-health-check",
  name: "Repository Health Check",
  category: "dev",
  description: "Analyze repository quality: code structure, test coverage indicators, documentation completeness, and potential issues.",
  goalTemplate: "Perform a comprehensive health check of this Git repository. Analyze the project structure, identify code quality issues, check for documentation gaps, review dependency health, and produce a detailed report as REPORT.md. Include actionable recommendations.",
  constraintTemplates: [
    "Only read files — do not modify any repository content",
    "Focus on structural analysis, not line-by-line code review",
    "Report must be written as REPORT.md in the workspace root"
  ],
  successCriteriaTemplates: [
    "REPORT.md exists and contains at least 3 sections",
    "Report covers: project structure, documentation, dependencies",
    "No files were modified (read-only analysis)"
  ],
  params: []
};
