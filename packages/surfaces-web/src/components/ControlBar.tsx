import { useI18n } from "../i18n/useI18n.js";

interface ControlBarProps {
  busy: boolean;
  onControl: (action: "pause" | "cancel") => Promise<void>;
}

export function ControlBar({ busy, onControl }: ControlBarProps) {
  const { t } = useI18n();

  return (
    <div class="card control-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">{t("control.controls")}</p>
          <h3>{t("control.sessionActions")}</h3>
        </div>
      </div>
      <div class="control-bar">
        <button type="button" class="button-ghost" disabled={busy} onClick={() => void onControl("pause")}>{t("control.pause")}</button>
        <button
          type="button"
          class="button-primary"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("control.cancelConfirm"))) {
              void onControl("cancel");
            }
          }}
        >
          {t("control.cancel")}
        </button>
      </div>
    </div>
  );
}
