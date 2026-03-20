import type { WorkPack } from "../types.js";

export const depAudit: WorkPack = {
  id: "dep-audit",
  name: "Dependency Audit",
  category: "ops",
  description: "Audit project dependencies for known vulnerabilities, outdated versions, and license issues.",
  goalTemplate: "Audit the dependencies of this project. Check for known vulnerabilities using available audit tools (npm audit, pip audit, etc.), identify outdated packages, and flag any license concerns. Produce REPORT.md with sections: Vulnerabilities, Outdated Packages, License Summary, and Recommendations.",
  constraintTemplates: [
    "Only read package manifests and lock files — do not install or update packages",
    "Use shell commands for audit (npm audit --json, etc.)",
    "Report must be written as REPORT.md"
  ],
  successCriteriaTemplates: [
    "REPORT.md exists with Vulnerabilities and Outdated Packages sections",
    "Report is based on actual audit tool output, not fabricated data"
  ],
  params: []
};
