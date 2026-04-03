interface ErrorPanelProps {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}

export function ErrorPanel({ title, message, retryLabel, onRetry }: ErrorPanelProps) {
  return (
    <section class="card error-panel">
      <p class="eyebrow">Gateway</p>
      <h1>{title}</h1>
      <p class="app-subtitle">{message}</p>
      <div class="setup-actions">
        <button type="button" class="button-primary" onClick={onRetry}>
          {retryLabel}
        </button>
      </div>
    </section>
  );
}
