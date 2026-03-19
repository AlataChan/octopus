import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { ArtifactType, SessionState, WorkItemState } from "@octopus/work-contracts";

import {
  defaultLocale,
  type Locale,
  type MessageKey,
  formatDateTimeForLocale,
  formatTimeForLocale,
  isLocale,
  localeStorageKey,
  localizeKnownError,
  translate,
  translateArtifactType,
  translateRiskLevel,
  translateSessionState,
  translateWorkItemState
} from "./messages.js";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
  formatDateTime: (value: Date) => string;
  formatTime: (value: Date) => string;
  tSessionState: (state: SessionState) => string;
  tWorkItemState: (state: WorkItemState) => string;
  tArtifactType: (type: ArtifactType) => string;
  tRiskLevel: (riskLevel: string) => string;
  localizeError: (message: string) => string;
}

function createValue(locale: Locale, setLocale: (locale: Locale) => void): I18nContextValue {
  return {
    locale,
    setLocale,
    t: (key) => translate(locale, key),
    formatDateTime: (value) => formatDateTimeForLocale(locale, value),
    formatTime: (value) => formatTimeForLocale(locale, value),
    tSessionState: (state) => translateSessionState(locale, state),
    tWorkItemState: (state) => translateWorkItemState(locale, state),
    tArtifactType: (type) => translateArtifactType(locale, type),
    tRiskLevel: (riskLevel) => translateRiskLevel(locale, riskLevel),
    localizeError: (message) => localizeKnownError(locale, message)
  };
}

export const I18nContext = createContext<I18nContextValue>(createValue(defaultLocale, () => undefined));

interface I18nProviderProps {
  children: ComponentChildren;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale());

  useEffect(() => {
    writeStoredLocale(locale);
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const value = createValue(locale, setLocale);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

function readStoredLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(localeStorageKey);
    return isLocale(stored) ? stored : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(localeStorageKey, locale);
  } catch {
    // Ignore storage failures and keep the UI functional.
  }
}
