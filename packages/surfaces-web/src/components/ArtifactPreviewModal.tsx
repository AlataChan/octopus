import { useI18n } from "../i18n/useI18n.js";

interface ArtifactPreviewModalProps {
  path: string;
  content: string;
  error?: string | null;
  loading: boolean;
  onClose: () => void;
}

export function ArtifactPreviewModal({
  path,
  content,
  error,
  loading,
  onClose
}: ArtifactPreviewModalProps) {
  const { t } = useI18n();

  return (
    <div class="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        class="card artifact-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={path}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="panel-header">
          <div>
            <p class="eyebrow">{t("artifactPreview.eyebrow")}</p>
            <h2>{path}</h2>
          </div>
          <button type="button" class="button-ghost" onClick={onClose}>
            {t("artifactPreview.close")}
          </button>
        </div>

        {loading ? <p>{t("artifactPreview.loading")}</p> : null}
        {!loading && error ? <p class="error-text">{error}</p> : null}
        {!loading && !error ? <pre class="artifact-preview-content">{content}</pre> : null}
      </section>
    </div>
  );
}
