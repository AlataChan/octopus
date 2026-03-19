import type { ApprovalRequest } from "../api/client.js";

interface ApprovalDialogProps {
  approval: ApprovalRequest | null;
  onResolve: (action: "approve" | "deny") => Promise<void>;
}

export function ApprovalDialog({ approval, onResolve }: ApprovalDialogProps) {
  if (!approval) {
    return null;
  }

  return (
    <div class="card approval-dialog">
      <div class="panel-header">
        <h3>Approval Required</h3>
        <span>{approval.riskLevel}</span>
      </div>
      <p>{approval.description}</p>
      <div class="control-bar">
        <button type="button" onClick={() => void onResolve("approve")}>Approve</button>
        <button type="button" onClick={() => void onResolve("deny")}>Deny</button>
      </div>
    </div>
  );
}
