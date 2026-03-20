import type { SessionSummary } from "@octopus/work-contracts";

import { useI18n } from "../i18n/useI18n.js";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRefresh: () => Promise<void>;
}

export function SessionList({ sessions, selectedSessionId, onSelect, onRefresh }: SessionListProps) {
  const { t, tSessionState } = useI18n();

  return (
    <aside class="card sidebar">
      <div class="panel-header">
        <h2>{t("sessionList.title")}</h2>
        <button type="button" onClick={() => void onRefresh()}>{t("sessionList.refresh")}</button>
      </div>
      <ul class="session-list">
        {sessions.map((session) => {
          const primaryLabel = session.namedGoalId
            ?? session.goalSummary
            ?? session.goalId
            ?? toShortSessionId(session.id);
          const secondaryLabel = session.namedGoalId ? session.goalSummary : undefined;

          return (
            <li key={session.id}>
              <button
                type="button"
                class={`session-row ${selectedSessionId === session.id ? "selected" : ""}`}
                aria-label={primaryLabel}
                onClick={() => onSelect(session.id)}
              >
                <span class="session-row-top">
                  <span class={`session-dot is-${session.state}`} />
                  <span class="session-id">{primaryLabel}</span>
                </span>
                {secondaryLabel ? <span class="session-meta">{secondaryLabel}</span> : null}
                <span class="session-technical">{session.id}</span>
                <span class={`session-state-chip state-${session.state}`}>{tSessionState(session.state)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function toShortSessionId(sessionId: string): string {
  if (sessionId.length <= 16) {
    return sessionId;
  }

  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}
