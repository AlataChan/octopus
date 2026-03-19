import { useState } from "preact/hooks";

import { useI18n } from "../i18n/useI18n.js";

interface LoginFormProps {
  onLogin: (apiKey: string) => Promise<void>;
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const { t, localizeError } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await onLogin(apiKey);
      setApiKey("");
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
        <span>{t("login.apiKey")}</span>
        <input
          type="password"
          value={apiKey}
          onInput={(event) => setApiKey((event.currentTarget as HTMLInputElement).value)}
          placeholder="sk-..."
        />
      </label>
      {error ? <p class="error-text">{error}</p> : null}
      <button type="submit" disabled={submitting || apiKey.trim().length === 0}>
        {submitting ? t("login.connecting") : t("login.connect")}
      </button>
    </form>
  );
}
