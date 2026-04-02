import { useState } from "preact/hooks";

import { useI18n } from "../i18n/useI18n.js";

interface LoginFormProps {
  onLogin: (username: string, password: string) => Promise<void>;
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const { t, localizeError } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await onLogin(username, password);
      setUsername("");
      setPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? localizeError(submitError.message) : t("login.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form class="card login-form" onSubmit={handleSubmit}>
      <h1>{t("brand.name")}</h1>
      <p>{t("login.description")}</p>
      <label class="field">
        <span>{t("login.username")}</span>
        <input
          type="text"
          value={username}
          autoComplete="username"
          onInput={(event) => setUsername((event.currentTarget as HTMLInputElement).value)}
          placeholder="ops1"
        />
      </label>
      <label class="field">
        <span>{t("login.password")}</span>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onInput={(event) => setPassword((event.currentTarget as HTMLInputElement).value)}
          placeholder="••••••••"
        />
      </label>
      {error ? <p class="error-text">{error}</p> : null}
      <button type="submit" disabled={submitting || username.trim().length === 0 || password.trim().length === 0}>
        {submitting ? t("login.connecting") : t("login.connect")}
      </button>
    </form>
  );
}
