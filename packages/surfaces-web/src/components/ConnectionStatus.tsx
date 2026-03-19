import { defaultLocale, type Locale } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";

interface ConnectionStatusProps {
  state: "connecting" | "connected" | "disconnected";
  onToggleStatus: () => void;
  onLogout: () => void;
}

export function ConnectionStatus({ state, onToggleStatus, onLogout }: ConnectionStatusProps) {
  const { locale, setLocale, t } = useI18n();
  const stateLabel = {
    connecting: t("connection.connecting"),
    connected: t("connection.connected"),
    disconnected: t("connection.disconnected")
  }[state];

  return (
    <div class="connection-status card">
      <span class={`status-indicator status-pill ${state}`}>{stateLabel}</span>
      <div class="header-actions">
        <div class="locale-switcher" role="group" aria-label={t("connection.localeGroup")}>
          <LocaleButton currentLocale={locale} targetLocale={defaultLocale} label={t("connection.languageZh")} onSelect={setLocale} />
          <LocaleButton currentLocale={locale} targetLocale="en-US" label={t("connection.languageEn")} onSelect={setLocale} />
        </div>
        <button type="button" class="button-ghost" onClick={onToggleStatus}>{t("connection.status")}</button>
        <button type="button" class="button-primary" onClick={onLogout}>{t("connection.logout")}</button>
      </div>
    </div>
  );
}

interface LocaleButtonProps {
  currentLocale: Locale;
  targetLocale: Locale;
  label: string;
  onSelect: (locale: Locale) => void;
}

function LocaleButton({ currentLocale, targetLocale, label, onSelect }: LocaleButtonProps) {
  const active = currentLocale === targetLocale;
  return (
    <button
      type="button"
      class={`locale-button ${active ? "active" : ""}`}
      aria-pressed={active}
      onClick={() => onSelect(targetLocale)}
    >
      {label}
    </button>
  );
}
