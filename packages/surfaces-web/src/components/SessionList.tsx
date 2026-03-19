import type { SessionSummary } from "@octopus/work-contracts";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRefresh: () => Promise<void>;
}

export function SessionList({ sessions, selectedSessionId, onSelect, onRefresh }: SessionListProps) {
  return (
    <aside class="card sidebar">
      <div class="panel-header">
        <h2>Sessions</h2>
        <button type="button" onClick={() => void onRefresh()}>Refresh</button>
      </div>
      <ul class="session-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              class={`session-row ${selectedSessionId === session.id ? "selected" : ""}`}
              onClick={() => onSelect(session.id)}
            >
              <span class={`session-dot is-${session.state}`} />
              <span>{session.id}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
