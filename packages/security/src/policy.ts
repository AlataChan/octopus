import type { Action } from "@octopus/work-contracts";

export type ActionCategory =
  | "read"
  | "patch"
  | "shell"
  | "modelApiCall"
  | "network"
  | "remote";

export type RiskLevel = "safe" | "consequential" | "dangerous";

export interface PolicyDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  riskLevel: RiskLevel;
  reason: string;
}

export interface SecurityPolicy {
  evaluate(action: Action, category: ActionCategory): PolicyDecision;
  approveForSession(actionPattern: string): void;
}

