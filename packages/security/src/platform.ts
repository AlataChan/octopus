import type { Action } from "@octopus/work-contracts";

import { allowPolicyDecision, denyPolicyDecision, type ActionCategory, type PolicyDecision, type PolicyFile, type SecurityPolicy } from "./policy.js";

export interface PlatformPolicyOptions {
  allowModelApiCall: boolean;
}

export class PlatformPolicy implements SecurityPolicy {
  private readonly allowedExecutables: Set<string>;

  constructor(
    private readonly policyFile: PolicyFile,
    private readonly options: PlatformPolicyOptions
  ) {
    this.allowedExecutables = new Set(policyFile.allowedExecutables ?? []);
  }

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
        return this.policyFile.allowNetwork
          ? allowPolicyDecision("consequential", "Network access allowed by platform policy.")
          : denyPolicyDecision("dangerous", "Network access denied by platform policy.");
      case "remote":
        return this.policyFile.allowRemote
          ? allowPolicyDecision("dangerous", "Remote attach allowed by platform policy.")
          : denyPolicyDecision("dangerous", "Remote attach denied by platform policy.");
      case "shell":
        return this.evaluateShellAction(action);
      default:
        return denyPolicyDecision("dangerous", `Unsupported action category: ${String(category)}`);
    }
  }

  approveForSession(_actionPattern: string): void {}

  private evaluateShellAction(action: Action): PolicyDecision {
    const executable = action.params.executable;
    if (typeof executable !== "string" || executable.length === 0) {
      throw new Error("Expected action.params.executable to be a non-empty string.");
    }

    if (this.allowedExecutables.has(executable)) {
      return allowPolicyDecision("consequential", `Shell executable allowed by platform policy: ${executable}`);
    }

    return denyPolicyDecision("dangerous", `Shell executable denied by platform policy: ${executable}`);
  }
}
