import { useEffect, useState } from "preact/hooks";

import type { WorkEvent } from "@octopus/observability";
import type { SessionSummary, WorkSession } from "@octopus/work-contracts";

import { GatewayClient, type ApprovalRequest, type StatusResponse } from "./api/client.js";
import { ConnectionStatus } from "./components/ConnectionStatus.js";
import { LoginForm } from "./components/LoginForm.js";
import { SessionDetail } from "./components/SessionDetail.js";
import { SessionList } from "./components/SessionList.js";
import { StatusPanel } from "./components/StatusPanel.js";

export function App() {
  const [client] = useState(() => new GatewayClient(globalThis.location?.origin ?? "http://127.0.0.1:4321"));
  const [authenticated, setAuthenticated] = useState(client.isAuthenticated());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<WorkSession | null>(null);
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const refreshSessions = async () => {
    const nextSessions = await client.listSessions();
    setSessions(nextSessions);
    if (!selectedSessionId && nextSessions[0]) {
      setSelectedSessionId(nextSessions[0].id);
    }
    if (selectedSessionId && !nextSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(nextSessions[0]?.id ?? null);
    }
  };

  const refreshSelectedSession = async (sessionId: string) => {
    setSelectedSession(await client.getSession(sessionId));
  };

  const refreshStatus = async () => {
    setStatus(await client.getStatus());
  };

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    void Promise.all([refreshSessions(), refreshStatus()]).catch((error) => {
      setPageError(error instanceof Error ? error.message : "Failed to load gateway data.");
    });
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !selectedSessionId) {
      setSelectedSession(null);
      setEvents([]);
      setApproval(null);
      setConnectionState("disconnected");
      return;
    }

    let active = true;
    setEvents([]);
    setApproval(null);
    setConnectionState("connecting");

    void refreshSelectedSession(selectedSessionId).catch((error) => {
      if (active) {
        setPageError(error instanceof Error ? error.message : "Failed to load session.");
      }
    });

    const stream = client.connectEventStream(
      selectedSessionId,
      (event) => {
        if (!active) {
          return;
        }
        setEvents((current) => [...current, event].slice(-200));
        if (
          event.type.startsWith("session.")
          || event.type.startsWith("workitem.")
          || event.type === "artifact.emitted"
        ) {
          void refreshSelectedSession(selectedSessionId).catch(() => undefined);
          void refreshSessions().catch(() => undefined);
        }
      },
      (nextApproval) => {
        if (active) {
          setApproval(nextApproval);
        }
      },
      () => {
        if (active) {
          setConnectionState("disconnected");
        }
      },
      (nextState) => {
        if (active) {
          setConnectionState(nextState);
        }
      }
    );

    return () => {
      active = false;
      stream.detach();
    };
  }, [authenticated, selectedSessionId]);

  const handleLogin = async (apiKey: string) => {
    await client.login(apiKey);
    setAuthenticated(true);
    setPageError(null);
  };

  const handleLogout = () => {
    client.logout();
    setAuthenticated(false);
    setSessions([]);
    setSelectedSessionId(null);
    setSelectedSession(null);
    setEvents([]);
    setApproval(null);
    setStatus(null);
    setPageError(null);
  };

  const handleControl = async (action: "pause" | "resume" | "cancel") => {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    try {
      await client.controlSession(selectedSessionId, action);
      await Promise.all([refreshSelectedSession(selectedSessionId), refreshSessions()]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Session control failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleResolveApproval = async (action: "approve" | "deny") => {
    if (!selectedSessionId || !approval) {
      return;
    }

    setBusy(true);
    try {
      await client.approvePrompt(selectedSessionId, approval.promptId, action);
      setApproval(null);
      await refreshSelectedSession(selectedSessionId);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!authenticated) {
    return (
      <main class="app-shell">
        <LoginForm onLogin={handleLogin} />
      </main>
    );
  }

  return (
    <main class="app-shell">
      <header class="app-header">
        <div>
          <h1>Octopus</h1>
          {pageError ? <p class="error-text">{pageError}</p> : null}
        </div>
        <ConnectionStatus
          state={connectionState}
          onToggleStatus={() => setShowStatus((current) => !current)}
          onLogout={handleLogout}
        />
      </header>

      <div class="layout">
        <SessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelect={setSelectedSessionId}
          onRefresh={refreshSessions}
        />
        <SessionDetail
          session={selectedSession}
          events={events}
          approval={approval}
          busy={busy}
          onControl={handleControl}
          onResolveApproval={handleResolveApproval}
        />
        <StatusPanel status={status} visible={showStatus} />
      </div>
    </main>
  );
}
