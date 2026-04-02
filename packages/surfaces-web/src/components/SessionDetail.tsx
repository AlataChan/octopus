import type { WorkEvent } from "@octopus/observability";
import type { SnapshotSummary } from "@octopus/state-store";
import type { Artifact, WorkSession } from "@octopus/work-contracts";

import type { ApprovalRequest } from "../api/client.js";
import { useI18n } from "../i18n/useI18n.js";
import { ApprovalDialog } from "./ApprovalDialog.js";
import { ClarificationDialog } from "./ClarificationDialog.js";
import { ControlBar } from "./ControlBar.js";
import { EventStream } from "./EventStream.js";

interface SessionDetailProps {
  session: WorkSession | null;
  events: WorkEvent[];
  snapshots?: SnapshotSummary[];
  approval: ApprovalRequest | null;
  busy: boolean;
  onControl?: (action: "pause" | "resume" | "cancel") => Promise<void>;
  onPreviewArtifact: (artifact: Artifact) => Promise<void>;
  onResolveApproval?: (action: "approve" | "deny") => Promise<void>;
  onClarify?: (answer: string) => void;
  onRollback?: (snapshotId: string) => Promise<void>;
}

export function SessionDetail({
  session,
  events,
  snapshots = [],
  approval,
  busy,
  onControl,
  onPreviewArtifact,
  onResolveApproval,
  onClarify,
  onRollback
}: SessionDetailProps) {
  const { t, tArtifactType, tSessionState, tWorkItemState, formatDateTime } = useI18n();

  if (!session) {
    return (
      <section class="card detail-panel">
        <p>{t("sessionDetail.empty")}</p>
      </section>
    );
  }

  const blockedReason = resolveBlockedReason(session, {
    unknownReason: t("sessionDetail.blockedUnknownReason"),
    pendingApproval: t("approval.pending")
  });

  return (
    <section class="detail-panel">
      <div class="card session-overview">
        <div class="panel-header">
          <div>
            <p class="eyebrow">{t("sessionDetail.selectedSession")}</p>
            <h2>{t("sessionDetail.overview")}</h2>
          </div>
          <span class={`status-indicator ${session.state}`}>{tSessionState(session.state)}</span>
        </div>
        <div class="session-kv-grid">
          <div class="session-kv">
            <span>{t("sessionDetail.taskTitle")}</span>
            <strong>{session.taskTitle ?? session.namedGoalId ?? session.goalSummary ?? session.goalId ?? session.id}</strong>
          </div>
          <div class="session-kv">
            <span>{t("sessionDetail.taskSummary")}</span>
            <strong>{session.goalSummary ?? session.goalId}</strong>
          </div>
          <div class="session-kv">
            <span>{t("sessionDetail.sessionId")}</span>
            <strong>{session.id}</strong>
          </div>
          <div class="session-kv">
            <span>{t("sessionDetail.goalId")}</span>
            <strong>{session.goalId}</strong>
          </div>
          <div class="session-kv">
            <span>{t("sessionDetail.created")}</span>
            <strong>{formatDateTime(session.createdAt)}</strong>
          </div>
          <div class="session-kv">
            <span>{t("sessionDetail.updated")}</span>
            <strong>{formatDateTime(session.updatedAt)}</strong>
          </div>
        </div>
      </div>

      {session.state === "blocked" ? (
        <div class="card blocked-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">{t("sessionDetail.blockedEyebrow")}</p>
              <h3>{t("sessionDetail.blockedTitle")}</h3>
            </div>
            <span class="session-state-chip state-blocked">{tSessionState(session.state)}</span>
          </div>
          <div class="blocked-card-copy">
            <span>{t("sessionDetail.blockedReason")}</span>
            <strong>{blockedReason ?? session.goalSummary ?? session.goalId}</strong>
          </div>
          {session.blockedReason?.kind === "clarification-required" && session.blockedReason.question && onClarify ? (
            <ClarificationDialog
              question={session.blockedReason.question}
              busy={busy}
              onAnswer={onClarify}
            />
          ) : session.blockedReason?.kind === "approval-required" ? (
            <p>{approval ? t("sessionDetail.blockedApprovalHint") : t("sessionDetail.blockedInspectHint")}</p>
          ) : (
            <p>{approval ? t("sessionDetail.blockedApprovalHint") : t("sessionDetail.blockedInspectHint")}</p>
          )}
        </div>
      ) : null}

      <div class="card section-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">{t("sessionDetail.execution")}</p>
            <h3>{t("sessionDetail.workItems")}</h3>
          </div>
          <span>{session.items.length}</span>
        </div>
        <ul class="data-list">
          {session.items.map((item) => (
            <li key={item.id} class="data-list-item">
              <span>{item.description}</span>
              <span class={`session-state-chip state-${item.state}`}>{tWorkItemState(item.state)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div class="card section-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">{t("sessionDetail.outputs")}</p>
            <h3>{t("sessionDetail.artifacts")}</h3>
          </div>
          <span>{session.artifacts.length}</span>
        </div>
        <ul class="data-list">
          {session.artifacts.map((artifact) => (
            <li key={artifact.id} class="data-list-item">
              <div class="artifact-copy">
                <span>{artifact.path}</span>
                <span class="session-meta">{artifact.description}</span>
              </div>
              <div class="artifact-actions">
                {isPreviewableArtifact(artifact) ? (
                  <button
                    type="button"
                    class="button-ghost"
                    aria-label={`${t("sessionDetail.preview")} ${artifact.path}`}
                    onClick={() => void onPreviewArtifact(artifact)}
                  >
                    {t("sessionDetail.preview")}
                  </button>
                ) : (
                  <button type="button" class="button-ghost" disabled>
                    {t("sessionDetail.previewUnavailable")}
                  </button>
                )}
                <span class={`session-state-chip artifact-chip`}>{tArtifactType(artifact.type)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div class="card section-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">{t("event.activity")}</p>
            <h3>{t("sessionDetail.checkpoints")}</h3>
          </div>
          <span>{snapshots.length}</span>
        </div>
        <div class="session-kv-grid">
          <div class="session-kv">
            <span>{t("sessionDetail.latestCheckpoint")}</span>
            <strong>{snapshots[0] ? formatDateTime(snapshots[0].capturedAt) : t("sessionDetail.noCheckpoints")}</strong>
          </div>
          <div class="session-kv">
            <span>{t("event.recentActivity")}</span>
            <strong>{`${events.length} ${t("sessionDetail.auditCountSuffix")}`}</strong>
          </div>
        </div>
        {snapshots.length > 0 ? (
          <ul class="data-list">
            {snapshots.map((snapshot) => (
              <li key={snapshot.snapshotId} class="data-list-item">
                <div class="artifact-copy">
                  <span>{snapshot.snapshotId}</span>
                  <span class="session-meta">{formatDateTime(snapshot.capturedAt)}</span>
                </div>
                {onRollback ? (
                  <button
                    type="button"
                    class="button-ghost"
                    disabled={busy}
                    aria-label={`${t("sessionDetail.rollbackPrefix")} ${snapshot.snapshotId}`}
                    onClick={() => void onRollback(snapshot.snapshotId)}
                  >
                    {`${t("sessionDetail.rollbackPrefix")} ${snapshot.snapshotId}`}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ControlBar busy={busy} sessionState={session.state} onControl={onControl} />
      <ApprovalDialog approval={approval} onResolve={onResolveApproval} />
      <EventStream events={events} />
    </section>
  );
}

function isPreviewableArtifact(artifact: Artifact): boolean {
  return artifact.type === "code"
    || artifact.type === "script"
    || artifact.type === "report"
    || artifact.type === "patch"
    || artifact.type === "document"
    || artifact.type === "runbook";
}

function resolveBlockedReason(
  session: WorkSession,
  labels: {
    unknownReason: string;
    pendingApproval: string;
  }
): string {
  const transitionReason = session.transitions
    .filter((transition) => transition.to === "blocked")
    .at(-1)?.reason ?? session.transitions.at(-1)?.reason;
  if (transitionReason) {
    return transitionReason;
  }

  if (session.blockedReason?.kind === "clarification-required") {
    return session.blockedReason.question ?? labels.unknownReason;
  }

  if (session.blockedReason?.kind === "approval-required") {
    return labels.pendingApproval;
  }

  if (session.blockedReason?.evidence) {
    return session.blockedReason.evidence;
  }

  return labels.unknownReason;
}
