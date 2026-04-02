import { useState } from "preact/hooks";

import { useI18n } from "../i18n/useI18n.js";

interface ClarificationDialogProps {
  question: string;
  busy: boolean;
  onAnswer: (answer: string) => Promise<void> | void;
}

export function ClarificationDialog({ question, busy, onAnswer }: ClarificationDialogProps) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState("");

  return (
    <div class="card clarification-dialog">
      <div class="panel-header">
        <div>
          <p class="eyebrow">{t("clarification.eyebrow")}</p>
          <h3>{t("clarification.heading")}</h3>
        </div>
      </div>
      <p class="clarification-question">{question}</p>
      <textarea
        class="clarification-input"
        value={answer}
        onInput={(e) => setAnswer((e.target as HTMLTextAreaElement).value)}
        placeholder={t("clarification.placeholder")}
        rows={3}
      />
      <button
        type="button"
        class="button-primary"
        disabled={busy || answer.trim().length === 0}
        onClick={() => void onAnswer(answer)}
      >
        {busy ? t("clarification.submitting") : t("clarification.submit")}
      </button>
    </div>
  );
}
