import { useState } from "preact/hooks";

interface LoginFormProps {
  onLogin: (apiKey: string) => Promise<void>;
}

export function LoginForm({ onLogin }: LoginFormProps) {
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
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form class="card login-form" onSubmit={handleSubmit}>
      <h1>Octopus</h1>
      <p>Enter the gateway API key to mint a browser session token.</p>
      <label class="field">
        <span>API Key</span>
        <input
          type="password"
          value={apiKey}
          onInput={(event) => setApiKey((event.currentTarget as HTMLInputElement).value)}
          placeholder="sk-..."
        />
      </label>
      {error ? <p class="error-text">{error}</p> : null}
      <button type="submit" disabled={submitting || apiKey.trim().length === 0}>
        {submitting ? "Connecting..." : "Connect"}
      </button>
    </form>
  );
}
