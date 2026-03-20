import type { VNode } from "preact";

import { useI18n } from "../i18n/useI18n.js";

interface ArtifactPreviewModalProps {
  path: string;
  content: string;
  error?: string | null;
  loading: boolean;
  onClose: () => void;
}

export function renderContent(path: string, content: string): VNode {
  const ext = path.split(".").pop()?.toLowerCase();

  if (ext === "json") {
    try {
      const formatted = JSON.stringify(JSON.parse(content), null, 2);
      return <pre class="artifact-preview-content artifact-json">{formatted}</pre>;
    } catch {
      return <pre class="artifact-preview-content">{content}</pre>;
    }
  }

  if (ext === "csv") {
    const rows = content.trim().split("\n").map((line) => line.split(","));
    if (rows.length === 0) {
      return <pre class="artifact-preview-content">{content}</pre>;
    }
    const [header, ...body] = rows;
    return (
      <div class="artifact-preview-content artifact-csv">
        <table class="csv-table">
          <thead>
            <tr>{header.map((cell, i) => <th key={i}>{cell.trim()}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell.trim()}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <pre class="artifact-preview-content">{content}</pre>;
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
        {!loading && !error ? renderContent(path, content) : null}
      </section>
    </div>
  );
}
