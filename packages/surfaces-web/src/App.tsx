import { useEffect, useState } from "preact/hooks";

import type { WorkEvent } from "@octopus/observability";
import type { SnapshotSummary } from "@octopus/state-store";
import type { Artifact, SessionSummary, WorkSession } from "@octopus/work-contracts";

import {
  GatewayClient,
  UnauthorizedError,
  type ApprovalRequest,
  type StatusResponse
} from "./api/client.js";
import type { AuthSession } from "./api/auth.js";
import { ArtifactPreviewModal } from "./components/ArtifactPreviewModal.js";
import { ConnectionStatus } from "./components/ConnectionStatus.js";
import { ErrorPanel } from "./components/ErrorPanel.js";
import { LoginForm } from "./components/LoginForm.js";
import { SessionDetail } from "./components/SessionDetail.js";
import { SessionList } from "./components/SessionList.js";
import { SetupWizard } from "./components/SetupWizard.js";
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
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [appMode, setAppMode] = useState<"checking" | "error" | "setup" | "ready">("checking");
  const [bootError, setBootError] = useState<string | null>(null);
  const [workspaceWritable, setWorkspaceWritable] = useState(true);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<WorkSession | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
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
  const canSubmitTasks = authSession?.role !== "viewer";
  const canControlSessions = authSession?.role !== "viewer";
  const canApproveSessions = authSession?.role !== "viewer";

  const resetToLogin = () => {
    client.clearAuthSession();
    setAuthSession(null);
    setAuthenticated(false);
    setSessions([]);
    setSelectedSessionId(null);
    setSelectedSession(null);
    setSnapshots([]);
    setEvents([]);
    setApproval(null);
    setStatus(null);
    setConnectionState("disconnected");
    setPageError(null);
    setShowComposer(false);
    setArtifactPreview(null);
  };

  const handleClientError = (error: unknown, fallbackMessage: string) => {
    if (error instanceof UnauthorizedError) {
      resetToLogin();
      return;
    }

    setPageError(error instanceof Error ? localizeError(error.message) : fallbackMessage);
  };

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

  const refreshSnapshots = async (sessionId: string) => {
    setSnapshots(await client.listSnapshots(sessionId));
  };

  const refreshStatus = async () => {
    setStatus(await client.getStatus());
  };

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setShowComposer(false);
  };

  const loadSetupStatus = async () => {
    setAppMode("checking");
    setBootError(null);

    try {
      const setupStatus = await client.getSetupStatus();
      setWorkspaceWritable(setupStatus.workspaceWritable);

      if (!setupStatus.initialized) {
        client.clearAuthSession();
        setAuthSession(null);
        setAuthenticated(false);
        setAppMode("setup");
        return;
      }

      const nextSession = client.getAuthSession();
      setAuthSession(nextSession);
      setAuthenticated(Boolean(nextSession));
      setAppMode("ready");
    } catch (error) {
      setBootError(error instanceof Error ? error.message : t("error.gatewayRequestFailed"));
      setAppMode("error");
    }
  };

  useEffect(() => {
    void loadSetupStatus();
  }, []);

  useEffect(() => {
    if (appMode !== "ready" || !authenticated) {
      return;
    }

    void Promise.all([refreshSessions(), refreshStatus()]).catch((error) => {
      handleClientError(error, t("error.loadGatewayDataFailed"));
    });
  }, [appMode, authenticated]);

  useEffect(() => {
    if (appMode !== "ready" || !authenticated || !selectedSessionId) {
      setSelectedSession(null);
      setSnapshots([]);
      setEvents([]);
      setApproval(null);
      setConnectionState("disconnected");
      return;
    }

    let active = true;
    setEvents([]);
    setApproval(null);
    setConnectionState("connecting");

    void Promise.all([refreshSelectedSession(selectedSessionId), refreshSnapshots(selectedSessionId)]).catch((error) => {
      if (active) {
        handleClientError(error, t("error.loadSessionFailed"));
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
          void Promise.all([
            refreshSelectedSession(selectedSessionId),
            refreshSessions(),
            refreshSnapshots(selectedSessionId)
          ]).catch(() => undefined);
        }
      },
      (nextApproval) => {
        if (active) {
          setApproval(nextApproval);
        }
      },
      (reason) => {
        if (active) {
          if (reason === "auth.failed" || reason === "auth.timeout" || reason === "auth.expired") {
            resetToLogin();
            return;
          }
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
  }, [appMode, authenticated, selectedSessionId]);

  const handleLogin = async (username: string, password: string) => {
    const session = await client.login(username, password);
    setAuthSession(session);
    setAuthenticated(true);
    setPageError(null);
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await client.logout();
      setAuthSession(null);
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
    } catch (error) {
      handleClientError(error, t("error.gatewayRequestFailed"));
    } finally {
      setBusy(false);
    }
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
      handleClientError(error, t("error.sessionControlFailed"));
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
      handleClientError(error, t("error.approvalFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleClarify = async (answer: string) => {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    try {
      await client.submitClarification(selectedSessionId, answer);
      await refreshSelectedSession(selectedSessionId);
      setPageError(null);
    } catch (error) {
      handleClientError(error, t("error.sessionControlFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitTask = async (input: { description: string; namedGoalId?: string; taskTitle?: string }) => {
    setBusy(true);
    try {
      const response = await client.submitGoal(input);
      await refreshSessions();
      setSelectedSessionId(response.sessionId);
      await refreshSelectedSession(response.sessionId);
      setShowComposer(false);
      setPageError(null);
    } catch (error) {
      handleClientError(error, t("error.taskSubmitFailed"));
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
      if (error instanceof UnauthorizedError) {
        resetToLogin();
        return;
      }

      setArtifactPreview({
        path: artifact.path,
        content: "",
        loading: false,
        error: error instanceof Error ? localizeError(error.message) : t("error.artifactLoadFailed")
      });
    }
  };

  const handleRollback = async (snapshotId: string) => {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    try {
      const result = await client.rollbackSession(selectedSessionId, snapshotId);
      setSelectedSessionId(result.sessionId);
      await Promise.all([
        refreshSessions(),
        refreshSelectedSession(result.sessionId),
        refreshSnapshots(result.sessionId)
      ]);
      setPageError(null);
    } catch (error) {
      handleClientError(error, t("error.sessionControlFailed"));
    } finally {
      setBusy(false);
    }
  };

  const showComposerPanel = canSubmitTasks && (showComposer || !selectedSessionId);

  if (appMode === "checking") {
    return (
      <main class="app-shell app-gate">
        <section class="card app-loading-panel">
          <p class="eyebrow">{t("brand.name")}</p>
          <h1>{t("app.connectingGateway")}</h1>
          <p class="app-subtitle">{t("app.connectingGatewayDescription")}</p>
        </section>
      </main>
    );
  }

  if (appMode === "error") {
    return (
      <main class="app-shell app-gate">
        <ErrorPanel
          title={t("errorPanel.title")}
          message={localizeError(bootError ?? t("error.gatewayRequestFailed"))}
          retryLabel={t("errorPanel.retry")}
          onRetry={() => {
            void loadSetupStatus();
          }}
        />
      </main>
    );
  }

  if (appMode === "setup") {
    return (
      <main class="app-shell app-gate">
        <SetupWizard
          workspaceWritable={workspaceWritable}
          validateSetupToken={(token) => client.validateSetupToken(token)}
          validateRuntime={(token, runtime) => client.validateRuntime(token, runtime)}
          initialize={(token, payload) => client.initialize(token, payload)}
          onContinueToLogin={() => {
            client.clearAuthSession();
            setAuthSession(null);
            setAuthenticated(false);
            setPageError(null);
            setAppMode("ready");
          }}
        />
      </main>
    );
  }

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
          {canSubmitTasks ? (
            <button type="button" class="button-primary" onClick={() => setShowComposer(true)}>
              {t("app.newTask")}
            </button>
          ) : null}
          <ConnectionStatus
            state={connectionState}
            onToggleStatus={() => setShowStatus((current) => !current)}
            onLogout={() => {
              void handleLogout();
            }}
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
              snapshots={snapshots}
              approval={approval}
              busy={busy}
              onControl={canControlSessions ? handleControl : undefined}
              onPreviewArtifact={handlePreviewArtifact}
              onResolveApproval={canApproveSessions ? handleResolveApproval : undefined}
              onClarify={canApproveSessions ? handleClarify : undefined}
              onRollback={canControlSessions ? handleRollback : undefined}
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
