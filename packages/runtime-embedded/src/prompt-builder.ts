import type { ContextPayload } from "@octopus/agent-runtime";
import type { ActionResult, WorkSession } from "@octopus/work-contracts";

export function buildTurnPrompt(input: {
  session: WorkSession;
  context?: ContextPayload;
  results: ActionResult[];
}): string {
  const context = input.context;
  const latestResult = input.results.at(-1);

  return [
    "You are Octopus, a local-first work agent runtime.",
    "Return ONLY JSON matching this schema:",
    '{"kind":"action","action":{"id":"string","type":"read|patch|shell|search","params":{},"createdAt":"ISO8601"}}',
    'or {"kind":"completion","evidence":"string"}',
    'or {"kind":"blocked","reason":"string"}',
    'or {"kind":"clarification","question":"string"}',
    "",
    `Session ID: ${input.session.id}`,
    `Goal ID: ${input.session.goalId}`,
    `State: ${input.session.state}`,
    `Workspace summary: ${context?.workspaceSummary ?? "n/a"}`,
    `Visible files: ${(context?.visibleFiles ?? []).join(", ") || "n/a"}`,
    `Plan: ${context?.plan ?? "n/a"}`,
    `TODO: ${context?.todo ?? "n/a"}`,
    `STATUS: ${context?.status ?? "n/a"}`,
    latestResult ? `Latest tool result: ${latestResult.output}` : "Latest tool result: none"
  ].join("\n");
}

