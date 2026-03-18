import type { Action } from "@octopus/work-contracts";

import { allowPolicyDecision, denyPolicyDecision, type ActionCategory, type PolicyDecision, type SecurityPolicy } from "./policy.js";

export interface VibePolicyOptions {
  allowModelApiCall: boolean;
}

export class VibePolicy implements SecurityPolicy {
  constructor(private readonly options: VibePolicyOptions) {}

  evaluate(_action: Action, category: ActionCategory): PolicyDecision {
    switch (category) {
      case "modelApiCall":
        return this.options.allowModelApiCall
          ? allowPolicyDecision("safe", "Configured model API channel is enabled.")
          : denyPolicyDecision("consequential", "Model API channel is disabled.");
      case "remote":
        return denyPolicyDecision("dangerous", "Remote attach is not available in Phase 2.");
      default:
        return allowPolicyDecision("safe", "vibe profile");
    }
  }

  approveForSession(_actionPattern: string): void {}
}
