import { useEffect, useState } from "preact/hooks";

import type { WorkEvent } from "@octopus/observability";
import type { Artifact, SessionSummary, WorkSession } from "@octopus/work-contracts";

import { GatewayClient, type ApprovalRequest, type EventStreamHandle, type StatusResponse } from "./api/client.js";
import { ArtifactPreviewModal } from "./components/ArtifactPreviewModal.js";
import { ConnectionStatus } from "./components/ConnectionStatus.js";
import { LoginForm } from "./components/LoginForm.js";
import { SessionDetail } from "./components/SessionDetail.js";
import { SessionList } from "./components/SessionList.js";
import { TaskComposer } from "./components/TaskComposer.js";
import { I18nProvider } from "./i18n/I18nProvider.js";
import { useI18n } from "./i18n/useI18n.js";
import { StatusPanel } from "./components/StatusPanel.js";

export function App() {
  return (
    <I18nProvider>
      <AppView />
    </I18nProvider>
  );
}

function AppView() {
  const { t, localizeError } = useI18n();
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
  const [showComposer, setShowComposer] = useState(false);
  const [streamHandle, setStreamHandle] = useState<EventStreamHandle | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<{
    path: string;
    content: string;
    loading: boolean;
    error: string | null;
  } | null>(null);

  const summary = sessions.reduce(
    (current, session) => {
      current.total += 1;
      if (session.state === "active") {
        current.active += 1;
      }
      if (session.state === "blocked") {
        current.blocked += 1;
      }
      if (session.state === "completed") {
        current.completed += 1;
      }
      return current;
    },
    {
      total: 0,
      active: 0,
      blocked: 0,
      completed: 0,
      items: selectedSession?.items.length ?? 0,
      artifacts: selectedSession?.artifacts.length ?? 0
    }
  );

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

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setShowComposer(false);
  };

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    void Promise.all([refreshSessions(), refreshStatus()]).catch((error) => {
      setPageError(error instanceof Error ? localizeError(error.message) : t("error.loadGatewayDataFailed"));
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
        setPageError(error instanceof Error ? localizeError(error.message) : t("error.loadSessionFailed"));
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
    setStreamHandle(stream);

    return () => {
      active = false;
      stream.detach();
      setStreamHandle(null);
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
    setShowComposer(false);
    setArtifactPreview(null);
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
      setPageError(error instanceof Error ? localizeError(error.message) : t("error.sessionControlFailed"));
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
      setPageError(error instanceof Error ? localizeError(error.message) : t("error.approvalFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleClarify = (answer: string) => {
    streamHandle?.sendClarification(answer);
  };

  const handleSubmitTask = async (input: { description: string; namedGoalId?: string }) => {
    setBusy(true);
    try {
      const response = await client.submitGoal(input);
      await refreshSessions();
      setSelectedSessionId(response.sessionId);
      await refreshSelectedSession(response.sessionId);
      setShowComposer(false);
      setPageError(null);
    } catch (error) {
      setPageError(error instanceof Error ? localizeError(error.message) : t("error.taskSubmitFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewArtifact = async (artifact: Artifact) => {
    if (!selectedSessionId) {
      return;
    }

    setArtifactPreview({
      path: artifact.path,
      content: "",
      loading: true,
      error: null
    });

    try {
      const payload = await client.getArtifactContent(selectedSessionId, artifact.path);
      setArtifactPreview({
        path: payload.path,
        content: payload.content,
        loading: false,
        error: null
      });
    } catch (error) {
      setArtifactPreview({
        path: artifact.path,
        content: "",
        loading: false,
        error: error instanceof Error ? localizeError(error.message) : t("error.artifactLoadFailed")
      });
    }
  };

  const showComposerPanel = showComposer || !selectedSessionId;

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
        <div class="app-header-copy">
          <p class="eyebrow">{t("app.operatorDashboard")}</p>
          <h1>{t("brand.name")}</h1>
          <p class="app-subtitle">{t("app.subtitle")}</p>
          {pageError ? <p class="error-text">{pageError}</p> : null}
        </div>
        <div class="app-toolbar">
          <button type="button" class="button-primary" onClick={() => setShowComposer(true)}>
            {t("app.newTask")}
          </button>
          <ConnectionStatus
            state={connectionState}
            onToggleStatus={() => setShowStatus((current) => !current)}
            onLogout={handleLogout}
          />
        </div>
      </header>

      <section class="summary-band" aria-label={t("app.dashboardSummaryAria")}>
        <article class="card summary-card">
          <span class="summary-label">{t("summary.totalSessions")}</span>
          <strong class="summary-value">{summary.total}</strong>
        </article>
        <article class="card summary-card">
          <span class="summary-label">{t("summary.active")}</span>
          <strong class="summary-value">{summary.active}</strong>
        </article>
        <article class="card summary-card">
          <span class="summary-label">{t("summary.blocked")}</span>
          <strong class="summary-value">{summary.blocked}</strong>
        </article>
        <article class="card summary-card">
          <span class="summary-label">{t("summary.completed")}</span>
          <strong class="summary-value">{summary.completed}</strong>
        </article>
        <article class="card summary-card">
          <span class="summary-label">{t("summary.selectedItems")}</span>
          <strong class="summary-value">{summary.items}</strong>
        </article>
        <article class="card summary-card">
          <span class="summary-label">{t("summary.artifacts")}</span>
          <strong class="summary-value">{summary.artifacts}</strong>
        </article>
      </section>

      <div class="layout">
        <SessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelect={handleSelectSession}
          onRefresh={refreshSessions}
        />
        <div class="main-column">
          {showComposerPanel ? (
            <TaskComposer
              busy={busy}
              dismissable={Boolean(selectedSessionId)}
              onDismiss={() => setShowComposer(false)}
              onSubmit={handleSubmitTask}
            />
          ) : null}
          {selectedSessionId ? (
            <SessionDetail
              session={selectedSession}
              events={events}
              approval={approval}
              busy={busy}
              onControl={handleControl}
              onPreviewArtifact={handlePreviewArtifact}
              onResolveApproval={handleResolveApproval}
              onClarify={handleClarify}
            />
          ) : null}
        </div>
        <StatusPanel status={status} visible={showStatus} />
      </div>

      {artifactPreview ? (
        <ArtifactPreviewModal
          path={artifactPreview.path}
          content={artifactPreview.content}
          loading={artifactPreview.loading}
          error={artifactPreview.error}
          onClose={() => setArtifactPreview(null)}
        />
      ) : null}
    </main>
  );
}
