import type { ApprovalRequest } from "../api/client.js";
import { useI18n } from "../i18n/useI18n.js";

interface ApprovalDialogProps {
  approval: ApprovalRequest | null;
  onResolve?: (action: "approve" | "deny") => Promise<void>;
}

export function ApprovalDialog({ approval, onResolve }: ApprovalDialogProps) {
  const { t, tRiskLevel } = useI18n();

  if (!approval || !onResolve) {
    return null;
  }

  return (
    <div class="card approval-dialog">
      <div class="panel-header">
        <div>
          <p class="eyebrow">{t("approval.attention")}</p>
          <h3>{t("approval.pending")}</h3>
        </div>
        <span class="risk-chip">{tRiskLevel(approval.riskLevel)}</span>
      </div>
      <p>{approval.description}</p>
      <div class="control-bar">
        <button type="button" class="button-primary" onClick={() => void onResolve("approve")}>{t("approval.approve")}</button>
        <button type="button" class="button-ghost" onClick={() => void onResolve("deny")}>{t("approval.deny")}</button>
      </div>
    </div>
  );
}
