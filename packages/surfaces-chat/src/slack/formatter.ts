import type { GatewaySession, SlackBlocks } from "../types.js";

export function formatCompletionNotification(session: GatewaySession, goalDescription: string): SlackBlocks {
  const failed = session.state === "failed";
  const title = failed ? "Goal Failed" : "Goal Complete";
  const emoji = failed ? "❌" : "✅";
  const artifactCount = session.artifacts?.length ?? 0;
  const duration = formatDuration(session.createdAt, session.updatedAt);
  const lines = [
    `Session: ${session.id}`,
    `Goal: ${goalDescription}`,
    `Artifacts: ${artifactCount}`,
    `Duration: ${duration}`
  ];

  if (failed && session.error) {
    lines.push(`Error: ${session.error}`);
  }

  return {
    text: `${emoji} ${title}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} ${title}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: lines.join("\n")
        }
      }
    ]
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
