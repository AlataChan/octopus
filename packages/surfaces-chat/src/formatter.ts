import type { GatewaySession, NotificationPayload } from "./types.js";

export function formatCompletionNotification(session: GatewaySession, goalDescription: string): NotificationPayload {
  const failed = session.state === "failed";
  const title = failed ? "Goal Failed" : "Goal Complete";
  const artifactCount = session.artifacts?.length ?? 0;
  const duration = formatDuration(session.createdAt, session.updatedAt);

  return {
    text: title,
    sessionId: session.id,
    state: failed ? "failed" : "completed",
    goalDescription,
    artifactCount,
    duration,
    ...(failed && session.error ? { error: session.error } : {})
  };
}

function formatDuration(createdAt?: string, updatedAt?: string): string {
  const start = createdAt ? Date.parse(createdAt) : Number.NaN;
  const end = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "n/a";
  }

  const totalSeconds = Math.floor((end - start) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
