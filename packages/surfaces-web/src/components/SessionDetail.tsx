import type { WorkEvent } from "@octopus/observability";
import type { WorkSession } from "@octopus/work-contracts";

import type { ApprovalRequest } from "../api/client.js";
import { ApprovalDialog } from "./ApprovalDialog.js";
import { ControlBar } from "./ControlBar.js";
import { EventStream } from "./EventStream.js";

interface SessionDetailProps {
  session: WorkSession | null;
  events: WorkEvent[];
  approval: ApprovalRequest | null;
  busy: boolean;
  onControl: (action: "pause" | "resume" | "cancel") => Promise<void>;
  onResolveApproval: (action: "approve" | "deny") => Promise<void>;
}

export function SessionDetail({
  session,
  events,
  approval,
  busy,
  onControl,
  onResolveApproval
}: SessionDetailProps) {
  if (!session) {
    return (
      <section class="card detail-panel">
        <p>Select a session to view details.</p>
      </section>
    );
  }

  return (
    <section class="detail-panel">
      <div class="card">
        <div class="panel-header">
          <h2>{session.id}</h2>
          <span class={`status-indicator ${session.state}`}>{session.state}</span>
        </div>
        <p>Goal ID: {session.goalId}</p>
        <p>Created: {session.createdAt.toLocaleString()}</p>
        <p>Updated: {session.updatedAt.toLocaleString()}</p>
      </div>

      <div class="card">
        <div class="panel-header">
          <h3>Work Items</h3>
          <span>{session.items.length}</span>
        </div>
        <ul class="data-list">
          {session.items.map((item) => (
            <li key={item.id}>{item.description} ({item.state})</li>
          ))}
        </ul>
      </div>

      <div class="card">
        <div class="panel-header">
          <h3>Artifacts</h3>
          <span>{session.artifacts.length}</span>
        </div>
        <ul class="data-list">
          {session.artifacts.map((artifact) => (
            <li key={artifact.id}>{artifact.path} ({artifact.type})</li>
          ))}
        </ul>
      </div>

      <ControlBar busy={busy} onControl={onControl} />
      <ApprovalDialog approval={approval} onResolve={onResolveApproval} />
      <EventStream events={events} />
    </section>
  );
}
