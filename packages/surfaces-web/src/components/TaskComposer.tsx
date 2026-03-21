import { useState } from "preact/hooks";

import { loadBuiltinPacks, validateParams } from "@octopus/work-packs/browser";
import type { WorkPack } from "@octopus/work-packs/browser";

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
  const [selectedPack, setSelectedPack] = useState<WorkPack | null>(null);
  const [packParams, setPackParams] = useState<Record<string, string>>({});
  const packs = loadBuiltinPacks();

  const handleSubmit = async (event: Event) => {
    event.preventDefault();

    let finalDescription = description.trim();
    let finalNamedGoalId = namedGoalId.trim();

    if (selectedPack) {
      try {
        validateParams(selectedPack, packParams);
      } catch {
        return;
      }
      const replace = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => packParams[k] ?? `{{${k}}}`);
      const parts = [replace(selectedPack.goalTemplate)];
      if (selectedPack.constraintTemplates.length > 0) {
        parts.push("\n\nConstraints:\n" + selectedPack.constraintTemplates.map((c) => `- ${replace(c)}`).join("\n"));
      }
      if (selectedPack.successCriteriaTemplates.length > 0) {
        parts.push("\n\nSuccess Criteria:\n" + selectedPack.successCriteriaTemplates.map((c) => `- ${replace(c)}`).join("\n"));
      }
      finalDescription = parts.join("");
      finalNamedGoalId = selectedPack.id;
    }

    if (!finalDescription) {
      return;
    }

    await onSubmit({
      description: finalDescription,
      ...(finalNamedGoalId.length > 0 ? { namedGoalId: finalNamedGoalId } : {})
    });

    setNamedGoalId("");
    setDescription("");
    setSelectedPack(null);
    setPackParams({});
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
        <div class="composer-field">
          <label>{t("taskComposer.template")}</label>
          <select
            value={selectedPack?.id ?? ""}
            onChange={(e) => {
              const packId = (e.target as HTMLSelectElement).value;
              const pack = packs.find((p) => p.id === packId) ?? null;
              setSelectedPack(pack);
              setPackParams({});
              if (pack) {
                setDescription(pack.goalTemplate);
                setNamedGoalId(pack.id);
              }
            }}
          >
            <option value="">{t("taskComposer.templateNone")}</option>
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name} [{pack.category}]
              </option>
            ))}
          </select>
        </div>

        {selectedPack && selectedPack.params.length > 0 ? (
          <div class="composer-params">
            {selectedPack.params.map((param) => (
              <div key={param.name} class="composer-field">
                <label>
                  {param.description}
                  {param.required ? " *" : ""}
                </label>
                <input
                  type="text"
                  value={packParams[param.name] ?? param.default ?? ""}
                  placeholder={param.name}
                  onInput={(e) => {
                    setPackParams((prev) => ({
                      ...prev,
                      [param.name]: (e.target as HTMLInputElement).value
                    }));
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}

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
          <button type="submit" class="button-primary" disabled={busy || description.trim().length === 0 || (selectedPack !== null && selectedPack.params.some((p) => p.required && !packParams[p.name]?.trim() && p.default === undefined))}>
            {busy ? t("taskComposer.submitting") : t("taskComposer.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}
