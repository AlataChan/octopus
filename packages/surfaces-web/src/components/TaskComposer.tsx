import { useState } from "preact/hooks";

import type { GoalSubmissionInput } from "../api/client.js";
import { useI18n } from "../i18n/useI18n.js";

interface TaskComposerProps {
  busy: boolean;
  dismissable?: boolean;
  onDismiss?: () => void;
  onSubmit: (input: GoalSubmissionInput) => Promise<void>;
}

export function TaskComposer({ busy, dismissable = false, onDismiss, onSubmit }: TaskComposerProps) {
  const { t } = useI18n();
  const [namedGoalId, setNamedGoalId] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    const nextDescription = description.trim();
    if (!nextDescription) {
      return;
    }

    await onSubmit({
      description: nextDescription,
      ...(namedGoalId.trim().length > 0 ? { namedGoalId: namedGoalId.trim() } : {})
    });

    setNamedGoalId("");
    setDescription("");
  };

  return (
    <section class="card task-composer">
      <div class="panel-header">
        <div>
          <p class="eyebrow">{t("taskComposer.eyebrow")}</p>
          <h2>{t("taskComposer.heading")}</h2>
        </div>
        {dismissable && onDismiss ? (
          <button type="button" class="button-ghost" onClick={onDismiss}>
            {t("taskComposer.close")}
          </button>
        ) : null}
      </div>

      <p class="task-composer-guidance">{t("taskComposer.guidance")}</p>

      <form class="task-composer-form" onSubmit={handleSubmit}>
        <label class="field">
          <span>{t("taskComposer.taskTitle")}</span>
          <input
            type="text"
            value={namedGoalId}
            placeholder={t("taskComposer.taskTitlePlaceholder")}
            onInput={(event) => setNamedGoalId((event.currentTarget as HTMLInputElement).value)}
          />
        </label>

        <label class="field">
          <span>{t("taskComposer.taskInstruction")}</span>
          <textarea
            value={description}
            placeholder={t("taskComposer.taskInstructionPlaceholder")}
            rows={5}
            onInput={(event) => setDescription((event.currentTarget as HTMLTextAreaElement).value)}
          />
        </label>

        <div class="task-composer-examples">
          <p class="task-composer-examples-title">{t("taskComposer.examples")}</p>
          <ul>
            <li>{t("taskComposer.exampleOne")}</li>
            <li>{t("taskComposer.exampleTwo")}</li>
          </ul>
          <p class="task-composer-warning">{t("taskComposer.warning")}</p>
        </div>

        <div class="task-composer-actions">
          <button type="submit" class="button-primary" disabled={busy || description.trim().length === 0}>
            {busy ? t("taskComposer.submitting") : t("taskComposer.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}
