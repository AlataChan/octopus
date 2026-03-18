import type { WorkEvent } from "@octopus/observability";
import type { Action, WorkGoal, WorkItem, WorkSession } from "@octopus/work-contracts";

export function renderPlan(_session: WorkSession, goal: WorkGoal): string {
  const constraints = goal.constraints.length > 0 ? goal.constraints.map((item) => `- ${item}`).join("\n") : "- none";
  const successCriteria =
    goal.successCriteria.length > 0 ? goal.successCriteria.map((item) => `- ${item}`).join("\n") : "- none";

  return `# PLAN\n\nGoal: ${goal.description}\n\n## Constraints\n${constraints}\n\n## Success Criteria\n${successCriteria}\n`;
}

export function renderTodo(items: WorkItem[]): string {
  const relevant = items.filter((item) => item.state === "pending" || item.state === "active");
  const lines = relevant.length > 0 ? relevant.map((item) => `- ${item.description}`).join("\n") : "- none";
  return `# TODO\n\n${lines}\n`;
}

export function renderStatus(session: WorkSession): string {
  const latestTransition = session.transitions.at(-1);
  const reason = latestTransition?.reason ?? "none";

  return `# STATUS\n\nSession: ${session.state}\nLatest transition: ${reason}\nKnown limitations: none\n`;
}

export function renderRunbook(session: WorkSession, goal: WorkGoal, trace: WorkEvent[]): string {
  const stepSections = session.items
    .map((item, index) => {
      const action = item.actions.at(-1);
      const verification = item.verifications.at(-1);
      return [
        `### Step ${index + 1} — ${item.description}`,
        `**Action**: ${action ? summarizeAction(action) : "none"}`,
        `**Result**: ${action?.result?.output ?? action?.result?.error ?? "none"}`,
        `**Verified**: ${verification ? `${verification.method} — ${verification.evidence}` : "none"}`
      ].join("\n");
    })
    .join("\n\n");

  const verificationSummary = session.items
    .flatMap((item) =>
      item.verifications.map((verification) => `| ${item.description} | ${verification.method} | ${verification.passed ? "pass" : "fail"} | n/a |`)
    )
    .join("\n");

  const traceSummary = trace
    .map((event) => `- ${event.type}`)
    .join("\n");

  return [
    `# Runbook: ${goal.description}`,
    "",
    `Generated: ${new Date().toISOString()}  Session: ${session.id}`,
    "",
    "## Goal",
    goal.description,
    `Constraints: ${goal.constraints.join(", ") || "none"}`,
    "",
    "## Steps",
    stepSections || "No steps recorded.",
    "",
    "## Known Limitations",
    "none",
    "",
    "## Verification Summary",
    "| Step | Method | Status | Score |",
    "| ---- | ------ | ------ | ----- |",
    verificationSummary || "| n/a | n/a | n/a | n/a |",
    "",
    "## Trace Events",
    traceSummary || "- none"
  ].join("\n");
}

function summarizeAction(action: Action): string {
  switch (action.type) {
    case "read":
      return `read \`${String(action.params.path ?? "unknown")}\``;
    case "patch":
      return `patch \`${String(action.params.path ?? "unknown")}\``;
    case "shell":
      return `\`${String(action.params.executable ?? "shell")} ${(action.params.args as string[] | undefined)?.join(" ") ?? ""}\``.trim();
    case "search":
      return `search \`${String(action.params.query ?? "unknown")}\``;
    case "model-call":
      return "`model-call`";
    default:
      return "`unknown`";
  }
}
