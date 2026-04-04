import type { ContextPayload } from "@octopus/agent-runtime";
import type { Action, ActionResult, WorkSession } from "@octopus/work-contracts";

const RECENT_ACTION_WINDOW = 5;
const TIME_SENSITIVE_GOAL_PATTERN =
  /\b(latest|current|recent|today|yesterday|tomorrow|hot|trending|breaking|weekly|daily)\b|最近|最新|当前|热点|热榜|本周|近一周|本日|今日/i;
const PROMPT_RESULT_DETAIL_THRESHOLD = 700;
const PROMPT_RESULT_DETAIL_HEAD = 320;
const PROMPT_RESULT_DETAIL_TAIL = 160;

export function buildTurnPrompt(input: {
  session: WorkSession;
  context?: ContextPayload;
  results: ActionResult[];
}): string {
  const context = input.context;
  const nowIso = new Date().toISOString();
  const mcpTools = context?.mcpTools;
  const latestResult = input.results.at(-1);
  const actionTypes = mcpTools?.length ? "read|patch|shell|search|mcp-call" : "read|patch|shell|search";
  const goalText = [input.session.taskTitle, input.session.goalSummary].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const timeSensitiveGoal = goalText.some((value) => TIME_SENSITIVE_GOAL_PATTERN.test(value));
  const visibleFilesLine = timeSensitiveGoal
    ? "Visible files: omitted for time-sensitive external-data tasks; consult upstream sources first"
    : `Visible files: ${(context?.visibleFiles ?? []).join(", ") || "n/a"}`;

  const lines = [
    "You are Octopus, a local-first work agent runtime.",
    "Return ONLY JSON matching this schema:",
    `{"kind":"action","action":{"id":"string","type":"${actionTypes}","params":{},"createdAt":"ISO8601"}}`,
    'or {"kind":"completion","evidence":"string"}',
    'or {"kind":"blocked","reason":"string"}',
    'or {"kind":"clarification","question":"string"}',
    "",
    "Action params requirements:",
    'read => {"path":"relative/path","encoding":"utf8?"}',
    'patch => {"path":"relative/path","content":"full file content"}',
    'search => {"query":"literal text"}',
    'shell => {"executable":"command","args":["..."],"timeoutMs":30000?}',
    "",
    "Use completion only when the goal is truly done, durable artifacts and status are updated, and no further tool action is needed.",
    "If the goal implies inspection, editing, verification, or artifact output work and you have not used a tool yet, take at least one tool action before considering completion.",
    "Do not repeat a successful action with identical params unless the previous result was incomplete, stale, or failed to answer the goal.",
    "Workspace files may come from prior sessions and can be stale.",
    "For latest/current/recent/hot/trending or other time-sensitive external information, do not rely on existing workspace files alone.",
    "Only treat external data as fresh if you fetched it or validated it against the upstream source during this session.",
    "For scripted HTTP requests in shell actions, prefer node with fetch because node is available in the runtime container.",
    "Do not wrap curl, wget, or python3 through node child_process when node can call fetch directly.",
    "Verify freshness against the upstream source before completing.",
    "Use clarification when you need a specific answer from the operator to continue.",
    "Use blocked only for unrecoverable failures such as parser, transport, or model/runtime errors.",
    "",
    `Current time (UTC): ${nowIso}`,
    `Session ID: ${input.session.id}`,
    `Goal ID: ${input.session.goalId}`,
    `Task title: ${input.session.taskTitle ?? "n/a"}`,
    `Goal summary: ${input.session.goalSummary ?? "n/a"}`,
    `State: ${input.session.state}`,
    `Workspace summary: ${context?.workspaceSummary ?? "n/a"}`,
    visibleFilesLine,
    `Plan: ${context?.plan ?? "n/a"}`,
    `TODO: ${context?.todo ?? "n/a"}`,
    `STATUS: ${context?.status ?? "n/a"}`,
    latestResult ? `Latest tool result: ${formatResultDetail(latestResult)}` : "Latest tool result: none"
  ];

  const actions = input.session.items.flatMap((item) => item.actions);
  const recentActions = actions.slice(-RECENT_ACTION_WINDOW);
  if (recentActions.length > 0) {
    lines.push("", "Recent actions:");
    for (const action of recentActions) {
      lines.push(`- ${summarizeAction(action)} -> ${summarizeOutcome(action.result)}`);
      if (action.result) {
        lines.push(`  Result: ${formatResultDetail(action.result)}`);
      }
    }
  }

  if (mcpTools?.length) {
    lines.push("", 'mcp-call => {"serverId":"server","toolName":"tool","arguments":{}}');
    lines.push("", 'Available MCP tools (use type: "mcp-call" with params: {serverId, toolName, arguments}):');
    for (const tool of mcpTools) {
      lines.push(`  - ${tool.serverId}/${tool.name}: ${tool.description ?? "no description"}`);
    }
  }

  return lines.join("\n");
}

function summarizeAction(action: Action): string {
  switch (action.type) {
    case "read":
      return `read path=${stringifyParam(action.params.path)} encoding=${stringifyParam(action.params.encoding ?? "utf8")}`;
    case "patch":
      return `patch path=${stringifyParam(action.params.path)}`;
    case "search":
      return `search query=${stringifyParam(action.params.query)}`;
    case "shell":
      return `shell ${stringifyParam(action.params.executable)} ${(action.params.args as string[] | undefined)?.join(" ") ?? ""}`.trim();
    case "mcp-call":
      return `mcp-call server=${stringifyParam(action.params.serverId)} tool=${stringifyParam(action.params.toolName)}`;
    default:
      return action.type;
  }
}

function summarizeOutcome(result?: ActionResult): string {
  if (!result) {
    return "pending";
  }

  if (result.outcome) {
    return result.outcome;
  }

  return result.success ? "completed" : "failed";
}

function formatResultDetail(result: ActionResult): string {
  const parts = [result.output, result.error].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  if (parts.length === 0) {
    return result.success ? "success with no output" : "no output";
  }

  return truncatePromptDetail(parts.join(" | "));
}

function stringifyParam(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return "unknown";
}

function truncatePromptDetail(value: string): string {
  if (value.length <= PROMPT_RESULT_DETAIL_THRESHOLD) {
    return value;
  }

  const truncatedCount = value.length - PROMPT_RESULT_DETAIL_HEAD - PROMPT_RESULT_DETAIL_TAIL;
  return `${value.slice(0, PROMPT_RESULT_DETAIL_HEAD)}...[truncated ${truncatedCount} chars]...${value.slice(
    -PROMPT_RESULT_DETAIL_TAIL
  )}`;
}
