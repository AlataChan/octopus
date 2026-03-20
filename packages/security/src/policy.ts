import type { Action, RiskLevel } from "@octopus/work-contracts";

export type { RiskLevel } from "@octopus/work-contracts";

export type ActionCategory =
  | "read"
  | "patch"
  | "shell"
  | "modelApiCall"
  | "network"
  | "remote";

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

export type SecurityProfileName = "safe-local" | "vibe" | "platform";

export type PolicyResolutionSource = "builtin" | "flag" | "global" | "default-deny";

export interface PolicyFile {
  schemaVersion: number;
  allowedExecutables?: string[];
  allowNetwork?: boolean;
  allowRemote?: boolean;
}

export interface PolicyResolution {
  profile: SecurityProfileName;
  source: PolicyResolutionSource;
  policyFilePath?: string;
  allowedExecutables?: string[];
  allowNetwork?: boolean;
  allowRemote?: boolean;
  defaultDeny: boolean;
}

export interface CreatePolicyOptions {
  allowModelApiCall?: boolean;
  workspaceRoot?: string;
  policyFilePath?: string;
  homeDir?: string;
}

export interface ResolvedSecurityPolicy {
  policy: SecurityPolicy;
  resolution: PolicyResolution;
}

export function allowPolicyDecision(
  riskLevel: PolicyDecision["riskLevel"],
  reason: string,
  requiresConfirmation = false
): PolicyDecision {
  return {
    allowed: true,
    requiresConfirmation,
    riskLevel,
    reason
  };
}

export function denyPolicyDecision(
  riskLevel: PolicyDecision["riskLevel"],
  reason: string
): PolicyDecision {
  return {
    allowed: false,
    requiresConfirmation: false,
    riskLevel,
    reason
  };
}
