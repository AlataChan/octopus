import type { Action } from "@octopus/work-contracts";

import { classifyShellRisk, createShellApprovalKey } from "./classifier.js";
import { allowPolicyDecision, denyPolicyDecision, type ActionCategory, type PolicyDecision, type SecurityPolicy } from "./policy.js";

export interface SafeLocalPolicyOptions {
  allowModelApiCall: boolean;
}

export class SafeLocalPolicy implements SecurityPolicy {
  private readonly approvals = new Set<string>();

  constructor(private readonly options: SafeLocalPolicyOptions) {}

  evaluate(action: Action, category: ActionCategory): PolicyDecision {
    switch (category) {
      case "read":
        return allowPolicyDecision("safe", "Workspace-scoped reads are allowed.");
      case "patch":
        return allowPolicyDecision("safe", "Workspace-scoped writes are allowed.");
      case "modelApiCall":
        return this.options.allowModelApiCall
          ? allowPolicyDecision("consequential", "Configured model API channel is enabled.")
          : denyPolicyDecision("consequential", "Model API channel is disabled.");
      case "network":
        return denyPolicyDecision("dangerous", "General network access is disabled in safe-local.");
      case "remote":
        return denyPolicyDecision("dangerous", "Remote attach is disabled in safe-local.");
      case "shell":
        return this.evaluateShellAction(action);
      default:
        return denyPolicyDecision("dangerous", `Unsupported action category: ${String(category)}`);
    }
  }

  approveForSession(actionPattern: string): void {
    this.approvals.add(actionPattern);
  }

  private evaluateShellAction(action: Action): PolicyDecision {
    const executable = getStringParam(action, "executable");
    const args = getStringArrayParam(action, "args");
    const approvalKey = createShellApprovalKey(executable, args);
    const riskLevel = classifyShellRisk(executable, args);

    if (this.approvals.has(approvalKey)) {
      return allowPolicyDecision(riskLevel, "Command previously approved for this session.", false);
    }

    if (riskLevel === "safe") {
      return allowPolicyDecision("safe", "Read-only shell command is allowed.", false);
    }

    return allowPolicyDecision(riskLevel, `Shell command requires confirmation (${approvalKey}).`, true);
  }
}

function getStringParam(action: Action, key: string): string {
  const value = action.params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected action.params.${key} to be a non-empty string.`);
  }

  return value;
}

function getStringArrayParam(action: Action, key: string): string[] {
  const value = action.params[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected action.params.${key} to be a string array.`);
  }

  return value as string[];
}
