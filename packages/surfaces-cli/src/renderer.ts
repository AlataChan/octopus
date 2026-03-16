import type { WorkEvent } from "@octopus/observability";

export function renderReplay(events: WorkEvent[]): string {
  return events.map(renderEvent).join("\n");
}

export function renderEvent(event: WorkEvent): string {
  const ts = event.timestamp.toISOString();

  switch (event.type) {
    case "file.read":
      return `${ts} file.read ${(event.payload as { path: string }).path}`;
    case "file.patched":
      return `${ts} file.patched ${(event.payload as { path: string }).path}`;
    case "command.executed":
      return `${ts} command.executed ${(event.payload as { executable: string; args: string[] }).executable} ${(event.payload as { executable: string; args: string[] }).args.join(" ")}`.trim();
    case "model.call":
      return `${ts} model.call ${(event.payload as { provider: string; model: string }).provider}/${(event.payload as { provider: string; model: string }).model}`;
    default:
      return `${ts} ${event.type}`;
  }
}

