import { useMemo, useState } from "preact/hooks";

import type { WorkEvent } from "@octopus/observability";
import type { Action, ActionTerminalOutcome, WorkSession } from "@octopus/work-contracts";

import { useI18n } from "../i18n/useI18n.js";

export interface ActionProgressStreams {
  stdout: string;
  stderr: string;
  info: string;
}

export type ActionProgressMap = Record<string, ActionProgressStreams>;

interface EventStreamProps {
  session: WorkSession;
  events: WorkEvent[];
  progressByActionId: ActionProgressMap;
}

interface ActionEventGroup {
  actionId: string;
  requested?: Extract<WorkEvent, { type: "action.requested" }>;
  completed?: Extract<WorkEvent, { type: "action.completed" }>;
  progressEvents: Array<Extract<WorkEvent, { type: "action.progress" }>>;
}

type EventEntry =
  | {
      kind: "event";
      event: WorkEvent;
    }
  | {
      kind: "action";
      group: ActionEventGroup;
    };

const EMPTY_PROGRESS: ActionProgressStreams = {
  stdout: "",
  stderr: "",
  info: ""
};

export function EventStream({ session, events, progressByActionId }: EventStreamProps) {
  const { t, formatTime } = useI18n();
  const [expandedByActionId, setExpandedByActionId] = useState<Record<string, boolean>>({});
  const actionLookup = useMemo(() => buildActionLookup(session), [session]);
  const entries = useMemo(() => groupEvents(events), [events]);

  return (
    <section class="card event-stream">
      <div class="panel-header">
        <div>
          <p class="eyebrow">{t("event.activity")}</p>
          <h3>{t("event.recentActivity")}</h3>
        </div>
        <span>{events.length}</span>
      </div>
      <div class="event-log">
        {entries.map((entry) => {
          if (entry.kind === "event") {
            return (
              <div class="event-line" key={entry.event.id}>
                <span>{formatTime(entry.event.timestamp)}</span>
                <span>{entry.event.type}</span>
                <span>{entry.event.sourceLayer}</span>
              </div>
            );
          }

          const action = actionLookup.get(entry.group.actionId);
          const progress = progressByActionId[entry.group.actionId] ?? EMPTY_PROGRESS;
          const expanded = expandedByActionId[entry.group.actionId] ?? false;

          return (
            <ActionBlock
              key={entry.group.actionId}
              action={action}
              group={entry.group}
              progress={progress}
              expanded={expanded}
              onToggle={() => {
                setExpandedByActionId((current) => ({
                  ...current,
                  [entry.group.actionId]: !expanded
                }));
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

interface ActionBlockProps {
  action?: Action;
  group: ActionEventGroup;
  progress: ActionProgressStreams;
  expanded: boolean;
  onToggle: () => void;
}

function ActionBlock({ action, group, progress, expanded, onToggle }: ActionBlockProps) {
  const { t, formatTime } = useI18n();
  const actionType = action?.type ?? group.requested?.payload.actionType ?? t("event.actionBlock");
  const summary = summarizeAction(action) ?? actionType;
  const outcome = action?.result?.outcome;
  const duration = action?.result?.durationMs;
  const timestamp = group.completed?.timestamp ?? group.requested?.timestamp;
  const hasProgress = progress.stdout.length > 0 || progress.stderr.length > 0 || progress.info.length > 0;
  const hasResultOutput = Boolean(action?.result?.output || action?.result?.error);

  return (
    <div class={`action-block ${expanded ? "expanded" : "collapsed"}`}>
      <button
        type="button"
        class="action-block-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <div class="action-block-header">
          <div class="action-block-primary">
            <span class="action-chip">{actionType}</span>
            <strong class="action-summary">{summary}</strong>
          </div>
          <div class="action-block-meta">
            {timestamp ? <span class="action-meta">{formatTime(timestamp)}</span> : null}
            {outcome ? <span class={`session-state-chip outcome-chip outcome-${outcome}`}>{translateOutcome(t, outcome)}</span> : null}
            {typeof duration === "number" ? <span class="action-meta">{formatDurationShort(duration)}</span> : null}
            <span class="action-toggle-icon" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          </div>
        </div>
      </button>

      {expanded ? (
        <div class="action-block-body">
          {action ? (
            <div class="action-block-section">
              <span class="action-block-label">{t("event.actionBlock")}</span>
              <div class="action-params-grid">
                <div class="action-params-card">
                  <span class="session-meta">{actionType}</span>
                  <strong>{summary}</strong>
                </div>
                <div class="action-params-card">
                  <span class="session-meta">JSON</span>
                  <pre class="action-json">{formatJson(action.params)}</pre>
                </div>
              </div>
            </div>
          ) : null}

          {hasProgress ? (
            <div class="action-block-section">
              <span class="action-block-label">{t("event.progress")}</span>
              <ProgressStream label="stdout" content={progress.stdout} tone="stdout" />
              <ProgressStream label="stderr" content={progress.stderr} tone="stderr" />
              <ProgressStream label="info" content={progress.info} tone="info" />
            </div>
          ) : null}

          {hasResultOutput ? (
            <div class="action-block-section">
              <span class="action-block-label">{t("sessionDetail.outputs")}</span>
              {action?.result?.output ? (
                <FormattedOutputBlock content={action.result.output} tone="result" />
              ) : null}
              {action?.result?.error ? (
                <FormattedOutputBlock content={action.result.error} tone="stderr" />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface ProgressStreamProps {
  label: string;
  content: string;
  tone: "stdout" | "stderr" | "info";
}

function ProgressStream({ label, content, tone }: ProgressStreamProps) {
  if (!content) {
    return null;
  }

  return (
    <div class={`action-output-block tone-${tone}`}>
      <div class="action-output-header">
        <span>{label}</span>
      </div>
      <FormattedOutputBlock content={content} tone={tone} />
    </div>
  );
}

interface FormattedOutputBlockProps {
  content: string;
  tone: "stdout" | "stderr" | "info" | "result";
}

function FormattedOutputBlock({ content, tone }: FormattedOutputBlockProps) {
  const lines = content.split("\n");
  const bulletLines = lines.filter((line) => line.trim().length > 0);
  const isBulletList = bulletLines.length > 0 && bulletLines.every((line) => line.trim().startsWith("- "));

  if (isBulletList) {
    return (
      <div class={`action-output-content tone-${tone}`}>
        <ul class="action-output-list">
          {bulletLines.map((line, index) => (
            <li key={`${tone}-${index}`}>{line.trim().slice(2)}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div class={`action-output-content tone-${tone}`}>
      {lines.map((line, index) => (
        <div key={`${tone}-${index}`} class="action-output-line">
          {line.length > 0 ? line : "\u00a0"}
        </div>
      ))}
    </div>
  );
}

function buildActionLookup(session: WorkSession): Map<string, Action> {
  const lookup = new Map<string, Action>();
  for (const item of session.items) {
    for (const action of item.actions) {
      lookup.set(action.id, action);
    }
  }
  return lookup;
}

function groupEvents(events: WorkEvent[]): EventEntry[] {
  const groups = new Map<string, ActionEventGroup>();
  const entries: EventEntry[] = [];

  for (const event of events) {
    if (event.type !== "action.requested" && event.type !== "action.completed" && event.type !== "action.progress") {
      entries.push({
        kind: "event",
        event
      });
      continue;
    }

    const actionId = event.payload.actionId;
    let group = groups.get(actionId);
    if (!group) {
      group = {
        actionId,
        progressEvents: []
      };
      groups.set(actionId, group);
      entries.push({
        kind: "action",
        group
      });
    }

    if (event.type === "action.requested") {
      group.requested = event;
    } else if (event.type === "action.completed") {
      group.completed = event;
    } else {
      group.progressEvents.push(event);
    }
  }

  return entries;
}

function summarizeAction(action?: Action): string | null {
  if (!action) {
    return null;
  }

  if (action.type === "shell") {
    const executable = readStringParam(action.params, "executable");
    const args = readStringArrayParam(action.params, "args");
    return [executable, ...args].filter(Boolean).join(" ").trim() || "shell";
  }

  if (action.type === "read" || action.type === "patch") {
    return readStringParam(action.params, "path") ?? action.type;
  }

  if (action.type === "search") {
    return readStringParam(action.params, "query") ?? action.type;
  }

  if (action.type === "mcp-call") {
    return readStringParam(action.params, "tool") ?? readStringParam(action.params, "toolName") ?? action.type;
  }

  return action.type;
}

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArrayParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatDurationShort(durationMs: number): string {
  if (durationMs >= 1_000) {
    return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  }
  return `${durationMs}ms`;
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function translateOutcome(
  t: (key: "outcome.completed" | "outcome.failed" | "outcome.denied" | "outcome.timedOut" | "outcome.cancelled" | "outcome.interrupted") => string,
  outcome: ActionTerminalOutcome
): string {
  switch (outcome) {
    case "completed":
      return t("outcome.completed");
    case "failed":
      return t("outcome.failed");
    case "denied":
      return t("outcome.denied");
    case "timed_out":
      return t("outcome.timedOut");
    case "cancelled":
      return t("outcome.cancelled");
    case "interrupted":
      return t("outcome.interrupted");
  }
}
