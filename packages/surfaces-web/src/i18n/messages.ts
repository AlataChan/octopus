import type { ArtifactType, SessionState, WorkItemState } from "@octopus/work-contracts";

export const defaultLocale = "zh-CN";
export const localeStorageKey = "octopus.locale";
export const supportedLocales = ["zh-CN", "en-US"] as const;

export type Locale = (typeof supportedLocales)[number];

const zhMessages = {
  "brand.name": "Octopus八爪鱼",
  "app.operatorDashboard": "运营面板",
  "app.subtitle": "在一个控制台中监控会话、审批、产物和网关健康状态。",
  "app.dashboardSummaryAria": "仪表盘摘要",
  "app.newTask": "新建任务",
  "summary.totalSessions": "全部会话",
  "summary.active": "进行中",
  "summary.blocked": "已阻塞",
  "summary.completed": "已完成",
  "summary.selectedItems": "当前事项",
  "summary.artifacts": "产物",
  "taskComposer.eyebrow": "任务",
  "taskComposer.heading": "新建任务",
  "taskComposer.taskTitle": "任务标题（可选）",
  "taskComposer.taskTitlePlaceholder": "例如：README 摘要",
  "taskComposer.taskInstruction": "任务说明",
  "taskComposer.taskInstructionPlaceholder": "描述要做什么、输出什么，以及任何约束。",
  "taskComposer.guidance": "写清楚要做什么、输出什么，以及任何约束。",
  "taskComposer.examples": "示例任务",
  "taskComposer.exampleOne": "读取 README.md，并在 docs/trial-summary.md 中写出 5 条中文要点；不要修改其它源码文件。",
  "taskComposer.exampleTwo": "检查 packages/gateway/src 里的 TODO，并输出一份 docs/gateway-todo-report.md。",
  "taskComposer.warning": "任务过于模糊时，更容易阻塞或验证失败。",
  "taskComposer.submit": "提交任务",
  "taskComposer.submitting": "提交中...",
  "taskComposer.template": "模板（可选）",
  "taskComposer.templateNone": "自定义目标（不使用模板）",
  "taskComposer.close": "关闭",
  "connection.status": "状态",
  "connection.logout": "退出",
  "connection.connecting": "连接中",
  "connection.connected": "已连接",
  "connection.disconnected": "已断开",
  "connection.localeGroup": "界面语言",
  "connection.languageZh": "中文",
  "connection.languageEn": "EN",
  "login.description": "输入网关 API 密钥以创建浏览器会话令牌。",
  "login.apiKey": "API 密钥",
  "login.connect": "连接",
  "login.connecting": "连接中...",
  "login.failed": "登录失败。",
  "sessionList.title": "会话",
  "sessionList.refresh": "刷新",
  "sessionDetail.empty": "选择一个会话以查看详情。",
  "sessionDetail.selectedSession": "当前会话",
  "sessionDetail.overview": "会话概览",
  "sessionDetail.taskTitle": "任务标题",
  "sessionDetail.taskSummary": "任务摘要",
  "sessionDetail.sessionId": "会话 ID",
  "sessionDetail.goalId": "目标 ID",
  "sessionDetail.created": "创建时间",
  "sessionDetail.updated": "更新时间",
  "sessionDetail.execution": "执行",
  "sessionDetail.workItems": "工作事项",
  "sessionDetail.outputs": "输出",
  "sessionDetail.artifacts": "产物",
  "sessionDetail.preview": "预览",
  "sessionDetail.previewUnavailable": "不可预览",
  "sessionDetail.copyPath": "复制路径",
  "sessionDetail.blockedEyebrow": "介入",
  "sessionDetail.blockedTitle": "阻塞原因",
  "sessionDetail.blockedReason": "当前阻塞",
  "sessionDetail.blockedApprovalHint": "Octopus 正在等待你的审批决定。",
  "sessionDetail.blockedInspectHint": "请先检查原因和产物，再决定是否发起后续任务。",
  "control.controls": "控制",
  "control.sessionActions": "会话操作",
  "control.pause": "暂停",
  "control.cancel": "取消",
  "control.cancelConfirm": "要取消这个远程会话吗？",
  "approval.attention": "注意",
  "approval.pending": "待审批",
  "approval.approve": "批准",
  "approval.deny": "拒绝",
  "event.activity": "活动",
  "event.recentActivity": "最近活动",
  "status.inspector": "检查器",
  "status.gatewayStatus": "网关状态",
  "status.profile": "配置",
  "status.host": "地址",
  "status.connectedClients": "连接客户端",
  "status.remoteAccess": "远程访问",
  "status.enabled": "已启用",
  "status.disabled": "已禁用",
  "status.loading": "加载中...",
  "status.rawJson": "原始 JSON",
  "artifactPreview.eyebrow": "产物预览",
  "artifactPreview.loading": "正在加载产物内容...",
  "artifactPreview.close": "关闭",
  "state.created": "已创建",
  "state.scoped": "已设定范围",
  "state.active": "进行中",
  "state.blocked": "已阻塞",
  "state.verifying": "验证中",
  "state.completed": "已完成",
  "state.failed": "失败",
  "state.cancelled": "已取消",
  "state.pending": "待处理",
  "state.done": "已完成",
  "state.skipped": "已跳过",
  "artifact.code": "代码",
  "artifact.script": "脚本",
  "artifact.report": "报告",
  "artifact.dataset": "数据集",
  "artifact.patch": "补丁",
  "artifact.document": "文档",
  "artifact.runbook": "运行手册",
  "artifact.other": "其他",
  "risk.safe": "安全",
  "risk.low": "低风险",
  "risk.medium": "中风险",
  "risk.high": "高风险",
  "risk.consequential": "需谨慎",
  "error.loadGatewayDataFailed": "加载网关数据失败。",
  "error.loadSessionFailed": "加载会话失败。",
  "error.sessionControlFailed": "会话操作失败。",
  "error.approvalFailed": "审批失败。",
  "error.taskSubmitFailed": "提交任务失败。",
  "error.artifactLoadFailed": "加载产物失败。",
  "error.gatewayRequestFailed": "网关请求失败。",
  "error.notAuthenticated": "尚未认证。"
} as const;

const enMessages: Record<keyof typeof zhMessages, string> = {
  "brand.name": "Octopus八爪鱼",
  "app.operatorDashboard": "Operator Dashboard",
  "app.subtitle": "Monitor sessions, approvals, artifacts, and gateway health from one control surface.",
  "app.dashboardSummaryAria": "Dashboard Summary",
  "app.newTask": "New Task",
  "summary.totalSessions": "Total Sessions",
  "summary.active": "Active",
  "summary.blocked": "Blocked",
  "summary.completed": "Completed",
  "summary.selectedItems": "Selected Items",
  "summary.artifacts": "Artifacts",
  "taskComposer.eyebrow": "Task",
  "taskComposer.heading": "Create Task",
  "taskComposer.taskTitle": "Task Title (Optional)",
  "taskComposer.taskTitlePlaceholder": "For example: README Summary",
  "taskComposer.taskInstruction": "Task Instruction",
  "taskComposer.taskInstructionPlaceholder": "Describe what to do, what to output, and any constraints.",
  "taskComposer.guidance": "Describe what to do, what to output, and any constraints.",
  "taskComposer.examples": "Example Tasks",
  "taskComposer.exampleOne": "Read README.md and write 5 Chinese bullet points to docs/trial-summary.md; do not modify any other source files.",
  "taskComposer.exampleTwo": "Inspect TODOs under packages/gateway/src and write a report to docs/gateway-todo-report.md.",
  "taskComposer.warning": "Vague tasks are more likely to block or fail verification.",
  "taskComposer.submit": "Submit Task",
  "taskComposer.submitting": "Submitting...",
  "taskComposer.template": "Template (optional)",
  "taskComposer.templateNone": "Custom goal (no template)",
  "taskComposer.close": "Close",
  "connection.status": "Status",
  "connection.logout": "Logout",
  "connection.connecting": "connecting",
  "connection.connected": "connected",
  "connection.disconnected": "disconnected",
  "connection.localeGroup": "Interface language",
  "connection.languageZh": "中文",
  "connection.languageEn": "EN",
  "login.description": "Enter the gateway API key to mint a browser session token.",
  "login.apiKey": "API Key",
  "login.connect": "Connect",
  "login.connecting": "Connecting...",
  "login.failed": "Login failed.",
  "sessionList.title": "Sessions",
  "sessionList.refresh": "Refresh",
  "sessionDetail.empty": "Select a session to view details.",
  "sessionDetail.selectedSession": "Selected Session",
  "sessionDetail.overview": "Session Overview",
  "sessionDetail.taskTitle": "Task Title",
  "sessionDetail.taskSummary": "Task Summary",
  "sessionDetail.sessionId": "Session ID",
  "sessionDetail.goalId": "Goal ID",
  "sessionDetail.created": "Created",
  "sessionDetail.updated": "Updated",
  "sessionDetail.execution": "Execution",
  "sessionDetail.workItems": "Work Items",
  "sessionDetail.outputs": "Outputs",
  "sessionDetail.artifacts": "Artifacts",
  "sessionDetail.preview": "Preview",
  "sessionDetail.previewUnavailable": "Unavailable",
  "sessionDetail.copyPath": "Copy Path",
  "sessionDetail.blockedEyebrow": "Intervention",
  "sessionDetail.blockedTitle": "Blocked Reason",
  "sessionDetail.blockedReason": "Current Block",
  "sessionDetail.blockedApprovalHint": "Octopus is waiting for your approval decision.",
  "sessionDetail.blockedInspectHint": "Inspect the reason and artifacts before starting a follow-up task.",
  "control.controls": "Controls",
  "control.sessionActions": "Session Actions",
  "control.pause": "Pause",
  "control.cancel": "Cancel",
  "control.cancelConfirm": "Cancel this remote session?",
  "approval.attention": "Attention",
  "approval.pending": "Pending Approval",
  "approval.approve": "Approve",
  "approval.deny": "Deny",
  "event.activity": "Activity",
  "event.recentActivity": "Recent Activity",
  "status.inspector": "Inspector",
  "status.gatewayStatus": "Gateway Status",
  "status.profile": "Profile",
  "status.host": "Host",
  "status.connectedClients": "Connected Clients",
  "status.remoteAccess": "Remote Access",
  "status.enabled": "Enabled",
  "status.disabled": "Disabled",
  "status.loading": "Loading...",
  "status.rawJson": "Raw JSON",
  "artifactPreview.eyebrow": "Artifact Preview",
  "artifactPreview.loading": "Loading artifact content...",
  "artifactPreview.close": "Close",
  "state.created": "created",
  "state.scoped": "scoped",
  "state.active": "active",
  "state.blocked": "blocked",
  "state.verifying": "verifying",
  "state.completed": "completed",
  "state.failed": "failed",
  "state.cancelled": "cancelled",
  "state.pending": "pending",
  "state.done": "done",
  "state.skipped": "skipped",
  "artifact.code": "code",
  "artifact.script": "script",
  "artifact.report": "report",
  "artifact.dataset": "dataset",
  "artifact.patch": "patch",
  "artifact.document": "document",
  "artifact.runbook": "runbook",
  "artifact.other": "other",
  "risk.safe": "safe",
  "risk.low": "low",
  "risk.medium": "medium",
  "risk.high": "high",
  "risk.consequential": "consequential",
  "error.loadGatewayDataFailed": "Failed to load gateway data.",
  "error.loadSessionFailed": "Failed to load session.",
  "error.sessionControlFailed": "Session control failed.",
  "error.approvalFailed": "Approval failed.",
  "error.taskSubmitFailed": "Failed to submit task.",
  "error.artifactLoadFailed": "Failed to load artifact.",
  "error.gatewayRequestFailed": "Gateway request failed.",
  "error.notAuthenticated": "Not authenticated."
};

export const messages = {
  "zh-CN": zhMessages,
  "en-US": enMessages
} as const;

export type MessageKey = keyof typeof zhMessages;

const sessionStateKeys: Record<SessionState, MessageKey> = {
  created: "state.created",
  scoped: "state.scoped",
  active: "state.active",
  blocked: "state.blocked",
  verifying: "state.verifying",
  completed: "state.completed",
  failed: "state.failed",
  cancelled: "state.cancelled"
};

const workItemStateKeys: Record<WorkItemState, MessageKey> = {
  pending: "state.pending",
  active: "state.active",
  done: "state.done",
  skipped: "state.skipped",
  failed: "state.failed"
};

const artifactTypeKeys: Record<ArtifactType, MessageKey> = {
  code: "artifact.code",
  script: "artifact.script",
  report: "artifact.report",
  dataset: "artifact.dataset",
  patch: "artifact.patch",
  document: "artifact.document",
  runbook: "artifact.runbook",
  other: "artifact.other"
};

const riskLevelKeys: Record<string, MessageKey> = {
  safe: "risk.safe",
  low: "risk.low",
  medium: "risk.medium",
  high: "risk.high",
  consequential: "risk.consequential"
};

const errorMessageKeys: Record<string, MessageKey> = {
  "Login failed.": "login.failed",
  "Gateway request failed.": "error.gatewayRequestFailed",
  "Not authenticated.": "error.notAuthenticated"
};

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && supportedLocales.includes(value as Locale);
}

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages[defaultLocale][key];
}

export function translateSessionState(locale: Locale, state: SessionState): string {
  return translate(locale, sessionStateKeys[state]);
}

export function translateWorkItemState(locale: Locale, state: WorkItemState): string {
  return translate(locale, workItemStateKeys[state]);
}

export function translateArtifactType(locale: Locale, type: ArtifactType): string {
  return translate(locale, artifactTypeKeys[type]);
}

export function translateRiskLevel(locale: Locale, riskLevel: string): string {
  const key = riskLevelKeys[riskLevel];
  return key ? translate(locale, key) : riskLevel;
}

export function localizeKnownError(locale: Locale, message: string): string {
  const key = errorMessageKeys[message];
  return key ? translate(locale, key) : message;
}

export function formatDateTimeForLocale(locale: Locale, value: Date): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}

export function formatTimeForLocale(locale: Locale, value: Date): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}
