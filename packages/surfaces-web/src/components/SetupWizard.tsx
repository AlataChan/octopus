import { useState } from "preact/hooks";

import type {
  SetupAdditionalUserInput,
  SetupInitializeInput,
  SetupInitializeResponse,
  SetupRuntimeConfigInput,
  SetupRuntimeValidationResponse,
  SetupTokenValidationResponse
} from "../api/client.js";
import { useI18n } from "../i18n/useI18n.js";

type SetupStep = "token" | "runtime" | "admin" | "users" | "review" | "success";

interface SetupWizardProps {
  workspaceWritable: boolean;
  validateSetupToken: (token: string) => Promise<SetupTokenValidationResponse>;
  validateRuntime: (
    token: string,
    runtime: SetupRuntimeConfigInput
  ) => Promise<SetupRuntimeValidationResponse>;
  initialize: (
    token: string,
    payload: SetupInitializeInput
  ) => Promise<SetupInitializeResponse>;
  onContinueToLogin: () => void;
}

const orderedSteps: SetupStep[] = ["token", "runtime", "admin", "users", "review", "success"];

export function SetupWizard({
  workspaceWritable,
  validateSetupToken,
  validateRuntime,
  initialize,
  onContinueToLogin
}: SetupWizardProps) {
  const { t, localizeError } = useI18n();
  const [step, setStep] = useState<SetupStep>("token");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const [runtimeLatencyMs, setRuntimeLatencyMs] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<{
    model: string;
    apiKey: string;
    baseUrl: string;
  }>({
    model: "",
    apiKey: "",
    baseUrl: ""
  });
  const [admin, setAdmin] = useState({
    username: "",
    password: "",
    confirmPassword: ""
  });
  const [additionalUsers, setAdditionalUsers] = useState<SetupAdditionalUserInput[]>([]);
  const [userDraft, setUserDraft] = useState<SetupAdditionalUserInput>({
    username: "",
    password: "",
    role: "operator"
  });

  const currentStepIndex = orderedSteps.indexOf(step);
  const normalizedSetupToken = setupToken.trim();
  const normalizedRuntime = toRuntimeInput(runtime);
  const normalizedAdmin = {
    username: admin.username.trim(),
    password: admin.password
  };
  const adminPasswordMismatch = admin.confirmPassword.length > 0 && admin.password !== admin.confirmPassword;
  const canAdvanceToken = workspaceWritable && normalizedSetupToken.length > 0 && !submitting;
  const canAdvanceRuntime = workspaceWritable
    && normalizedRuntime.model.length > 0
    && normalizedRuntime.apiKey.length > 0
    && !submitting;
  const canAdvanceAdmin = workspaceWritable
    && normalizedAdmin.username.length > 0
    && normalizedAdmin.password.length > 0
    && admin.confirmPassword.length > 0
    && !adminPasswordMismatch
    && !submitting;
  const canAddUser = workspaceWritable
    && userDraft.username.trim().length > 0
    && userDraft.password.length > 0
    && !submitting;
  const canInitialize = workspaceWritable && !submitting;

  const goBack = () => {
    setError(null);
    const nextIndex = Math.max(0, currentStepIndex - 1);
    setStep(orderedSteps[nextIndex] ?? "token");
  };

  const handleValidateToken = async (event: Event) => {
    event.preventDefault();
    if (!canAdvanceToken) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await validateSetupToken(normalizedSetupToken);
      setSetupToken(normalizedSetupToken);
      setStep("runtime");
    } catch (submitError) {
      setError(submitError instanceof Error ? localizeError(submitError.message) : t("error.gatewayRequestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidateRuntime = async (event: Event) => {
    event.preventDefault();
    if (!canAdvanceRuntime) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await validateRuntime(normalizedSetupToken, normalizedRuntime);
      if (!result.valid) {
        setError(localizeError(result.error ?? t("setup.runtime.validationFailed")));
        return;
      }
      setRuntimeLatencyMs(result.latencyMs ?? null);
      setStep("admin");
    } catch (submitError) {
      setError(submitError instanceof Error ? localizeError(submitError.message) : t("error.gatewayRequestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminNext = (event: Event) => {
    event.preventDefault();
    if (!canAdvanceAdmin) {
      return;
    }

    setError(null);
    setAdmin((current) => ({
      ...current,
      username: normalizedAdmin.username,
      password: normalizedAdmin.password
    }));
    setStep("users");
  };

  const handleAddUser = () => {
    if (!canAddUser) {
      return;
    }

    setAdditionalUsers((current) => [
      ...current,
      {
        username: userDraft.username.trim(),
        password: userDraft.password,
        role: userDraft.role
      }
    ]);
    setUserDraft({
      username: "",
      password: "",
      role: "operator"
    });
    setError(null);
  };

  const handleUsersNext = (event: Event) => {
    event.preventDefault();
    if (!workspaceWritable || submitting) {
      return;
    }

    setError(null);
    setStep("review");
  };

  const handleInitialize = async (event: Event) => {
    event.preventDefault();
    if (!canInitialize) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await initialize(normalizedSetupToken, {
        runtime: normalizedRuntime,
        admin: normalizedAdmin,
        ...(additionalUsers.length > 0 ? { additionalUsers } : {})
      });
      setStep("success");
    } catch (submitError) {
      setError(submitError instanceof Error ? localizeError(submitError.message) : t("error.gatewayRequestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section class="card setup-wizard">
      <header class="setup-header">
        <div class="app-header-copy">
          <p class="eyebrow">{t("setup.eyebrow")}</p>
          <h1>{t("setup.title")}</h1>
          <p class="app-subtitle">{t("setup.description")}</p>
        </div>
        <ol class="wizard-steps" aria-label={t("setup.progress")}>
          {orderedSteps.map((item, index) => (
            <li
              key={item}
              class={`wizard-step${index === currentStepIndex ? " active" : index < currentStepIndex ? " complete" : ""}`}
            >
              <span>{index + 1}</span>
              <strong>{t(`setup.step.${item}` as const)}</strong>
            </li>
          ))}
        </ol>
      </header>

      {!workspaceWritable ? <p class="error-text">{t("setup.workspaceNotWritable")}</p> : null}
      {error ? <p class="error-text">{error}</p> : null}

      {step === "token" ? (
        <form class="setup-form" onSubmit={handleValidateToken}>
          <h2>{t("setup.token.heading")}</h2>
          <p class="setup-note">{t("setup.token.description")}</p>
          <label class="field">
            <span>{t("setup.token.label")}</span>
            <input
              type="password"
              value={setupToken}
              autoComplete="off"
              onInput={(event) => setSetupToken((event.currentTarget as HTMLInputElement).value)}
              placeholder="octopus-setup-token"
            />
          </label>
          <div class="setup-actions">
            <button type="submit" class="button-primary" disabled={!canAdvanceToken}>
              {submitting ? t("setup.button.validating") : t("setup.token.submit")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "runtime" ? (
        <form class="setup-form" onSubmit={handleValidateRuntime} autoComplete="off">
          <h2>{t("setup.runtime.heading")}</h2>
          <p class="setup-note">{t("setup.runtime.description")}</p>
          <div class="setup-grid">
            <div class="field">
              <span>{t("setup.runtime.provider")}</span>
              <p class="setup-note" style={{ margin: "0.25rem 0 0" }}>OpenAI-Compatible API</p>
            </div>
            <label class="field">
              <span>{t("setup.runtime.model")}</span>
              <input
                type="text"
                value={runtime.model}
                autoComplete="one-time-code"
                onInput={(event) => setRuntime((current) => ({
                  ...current,
                  model: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="gpt-4.1-mini"
              />
            </label>
            <label class="field">
              <span>{t("setup.runtime.apiKey")}</span>
              <input
                type="password"
                value={runtime.apiKey}
                autoComplete="one-time-code"
                onInput={(event) => setRuntime((current) => ({
                  ...current,
                  apiKey: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="sk-..."
              />
            </label>
            <label class="field">
              <span>{t("setup.runtime.baseUrl")}</span>
              <input
                type="text"
                value={runtime.baseUrl}
                autoComplete="one-time-code"
                onInput={(event) => setRuntime((current) => ({
                  ...current,
                  baseUrl: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="https://api.openai.com/v1"
              />
            </label>
          </div>
          {runtimeLatencyMs !== null ? (
            <p class="setup-note">
              {t("setup.runtime.validationPassed")} {runtimeLatencyMs} ms
            </p>
          ) : null}
          <div class="setup-actions">
            <button type="button" class="button-ghost" onClick={goBack} disabled={submitting}>
              {t("setup.button.back")}
            </button>
            <button type="submit" class="button-primary" disabled={!canAdvanceRuntime}>
              {submitting ? t("setup.button.validating") : t("setup.runtime.submit")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "admin" ? (
        <form class="setup-form" onSubmit={handleAdminNext}>
          <h2>{t("setup.admin.heading")}</h2>
          <p class="setup-note">{t("setup.admin.description")}</p>
          <div class="setup-grid">
            <label class="field">
              <span>{t("setup.admin.username")}</span>
              <input
                type="text"
                value={admin.username}
                autoComplete="username"
                onInput={(event) => setAdmin((current) => ({
                  ...current,
                  username: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="ops-admin"
              />
            </label>
            <label class="field">
              <span>{t("setup.admin.password")}</span>
              <input
                type="password"
                value={admin.password}
                autoComplete="new-password"
                onInput={(event) => setAdmin((current) => ({
                  ...current,
                  password: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="••••••••"
              />
            </label>
            <label class="field">
              <span>{t("setup.admin.confirmPassword")}</span>
              <input
                type="password"
                value={admin.confirmPassword}
                autoComplete="new-password"
                onInput={(event) => setAdmin((current) => ({
                  ...current,
                  confirmPassword: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="••••••••"
              />
            </label>
          </div>
          {adminPasswordMismatch ? <p class="error-text">{t("setup.admin.passwordMismatch")}</p> : null}
          <div class="setup-actions">
            <button type="button" class="button-ghost" onClick={goBack}>
              {t("setup.button.back")}
            </button>
            <button type="submit" class="button-primary" disabled={!canAdvanceAdmin}>
              {t("setup.button.next")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "users" ? (
        <form class="setup-form" onSubmit={handleUsersNext}>
          <h2>{t("setup.users.heading")}</h2>
          <p class="setup-note">{t("setup.users.description")}</p>
          <div class="setup-grid">
            <label class="field">
              <span>{t("setup.users.username")}</span>
              <input
                type="text"
                value={userDraft.username}
                autoComplete="off"
                onInput={(event) => setUserDraft((current) => ({
                  ...current,
                  username: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="viewer-1"
              />
            </label>
            <label class="field">
              <span>{t("setup.users.password")}</span>
              <input
                type="password"
                value={userDraft.password}
                autoComplete="new-password"
                onInput={(event) => setUserDraft((current) => ({
                  ...current,
                  password: (event.currentTarget as HTMLInputElement).value
                }))}
                placeholder="••••••••"
              />
            </label>
            <label class="field">
              <span>{t("setup.users.role")}</span>
              <select
                value={userDraft.role}
                onChange={(event) => setUserDraft((current) => ({
                  ...current,
                  role: (event.currentTarget as HTMLSelectElement).value as SetupAdditionalUserInput["role"]
                }))}
              >
                <option value="operator">{t("setup.users.roleOperator")}</option>
                <option value="viewer">{t("setup.users.roleViewer")}</option>
              </select>
            </label>
          </div>

          <div class="setup-actions">
            <button type="button" onClick={handleAddUser} disabled={!canAddUser}>
              {t("setup.users.add")}
            </button>
          </div>

          {additionalUsers.length > 0 ? (
            <ul class="session-list setup-user-list">
              {additionalUsers.map((user) => (
                <li key={`${user.role}:${user.username}`} class="data-list-item setup-user-row">
                  <div class="artifact-copy">
                    <strong>{user.username}</strong>
                    <span>{user.role === "operator" ? t("setup.users.roleOperator") : t("setup.users.roleViewer")}</span>
                  </div>
                  <button
                    type="button"
                    class="button-ghost"
                    onClick={() => setAdditionalUsers((current) => current.filter((entry) => entry !== user))}
                  >
                    {t("setup.users.remove")} {user.username}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p class="setup-note">{t("setup.users.empty")}</p>
          )}

          <div class="setup-actions">
            <button type="button" class="button-ghost" onClick={goBack}>
              {t("setup.button.back")}
            </button>
            <button type="submit" class="button-primary" disabled={!workspaceWritable || submitting}>
              {t("setup.button.next")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "review" ? (
        <form class="setup-form" onSubmit={handleInitialize}>
          <h2>{t("setup.review.heading")}</h2>
          <p class="setup-note">{t("setup.review.description")}</p>
          <dl class="setup-review-grid">
            <div class="setup-review-item">
              <dt>{t("setup.review.runtimeModel")}</dt>
              <dd>{normalizedRuntime.model}</dd>
            </div>
            <div class="setup-review-item">
              <dt>{t("setup.review.runtimeBaseUrl")}</dt>
              <dd>{normalizedRuntime.baseUrl ?? t("setup.review.defaultBaseUrl")}</dd>
            </div>
            <div class="setup-review-item">
              <dt>{t("setup.review.adminUser")}</dt>
              <dd>{normalizedAdmin.username}</dd>
            </div>
            <div class="setup-review-item">
              <dt>{t("setup.review.additionalUsers")}</dt>
              <dd>{additionalUsers.length > 0 ? additionalUsers.map((user) => user.username).join(", ") : t("setup.review.none")}</dd>
            </div>
          </dl>
          <div class="setup-actions">
            <button type="button" class="button-ghost" onClick={goBack} disabled={submitting}>
              {t("setup.button.back")}
            </button>
            <button type="submit" class="button-primary" disabled={!canInitialize}>
              {submitting ? t("setup.button.initializing") : t("setup.review.submit")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "success" ? (
        <div class="setup-form">
          <h2>{t("setup.success.heading")}</h2>
          <p class="setup-note">{t("setup.success.description")}</p>
          <div class="setup-actions">
            <button type="button" class="button-primary" onClick={onContinueToLogin}>
              {t("setup.success.continue")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function toRuntimeInput(runtime: {
  model: string;
  apiKey: string;
  baseUrl: string;
}): SetupRuntimeConfigInput {
  const model = runtime.model.trim();
  const apiKey = runtime.apiKey.trim();
  const baseUrl = runtime.baseUrl.trim();

  return {
    provider: "openai-compatible",
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {})
  };
}
