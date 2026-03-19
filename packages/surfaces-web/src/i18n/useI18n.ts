import { useContext } from "preact/hooks";

import { I18nContext, type I18nContextValue } from "./I18nProvider.js";

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
