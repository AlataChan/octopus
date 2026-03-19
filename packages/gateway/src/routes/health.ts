import type { RouteDeps } from "./shared.js";

export async function handleHealth(deps: RouteDeps) {
  const sessions = await deps.store.listSessions();
  return {
    status: "ok" as const,
    uptime: process.uptime(),
    activeSessions: sessions.length
  };
}
