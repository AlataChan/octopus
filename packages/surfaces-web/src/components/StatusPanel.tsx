import type { StatusResponse } from "../api/client.js";
import { useI18n } from "../i18n/useI18n.js";

interface StatusPanelProps {
  status: StatusResponse | null;
  visible: boolean;
}

export function StatusPanel({ status, visible }: StatusPanelProps) {
  const { t } = useI18n();

  if (!visible) {
    return null;
  }

  const fields = status
    ? [
        { label: t("status.profile"), value: status.profile },
        { label: t("status.currentRole"), value: status.currentRole ?? t("status.loading") },
        { label: t("status.currentOperator"), value: status.currentOperator ?? t("status.loading") },
        { label: t("status.host"), value: `${status.host}:${status.port}` },
        { label: t("status.connectedClients"), value: String(status.connectedClients) },
        { label: t("status.remoteAccess"), value: status.allowRemote ? t("status.enabled") : t("status.disabled") },
        { label: t("status.browserLogin"), value: status.browserLoginConfigured ? t("status.enabled") : t("status.disabled") },
        { label: t("status.configuredUsers"), value: String(status.configuredUsers ?? 0) },
        { label: t("status.auditStream"), value: status.traceStreamingAvailable ? t("status.enabled") : t("status.disabled") }
      ]
    : [
        { label: t("status.profile"), value: t("status.loading") },
        { label: t("status.currentRole"), value: t("status.loading") },
        { label: t("status.currentOperator"), value: t("status.loading") },
        { label: t("status.host"), value: t("status.loading") },
        { label: t("status.connectedClients"), value: t("status.loading") },
        { label: t("status.remoteAccess"), value: t("status.loading") },
        { label: t("status.browserLogin"), value: t("status.loading") },
        { label: t("status.configuredUsers"), value: t("status.loading") },
        { label: t("status.auditStream"), value: t("status.loading") }
      ];

  return (
    <aside class="card status-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">{t("status.inspector")}</p>
          <h2>{t("status.gatewayStatus")}</h2>
        </div>
      </div>
      <dl class="status-grid">
        {fields.map((field) => (
          <div key={field.label} class="status-grid-item">
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <details class="status-raw">
        <summary>{t("status.rawJson")}</summary>
        <pre>{status ? JSON.stringify(status, null, 2) : t("status.loading")}</pre>
      </details>
    </aside>
  );
}
