export * from "./classifier.js";
export * from "./policy.js";
export * from "./platform-loader.js";
export * from "./platform.js";
export * from "./safe-local.js";
export * from "./vibe.js";

import { loadPlatformPolicy } from "./platform-loader.js";
import { PlatformPolicy } from "./platform.js";
import type { CreatePolicyOptions, ResolvedSecurityPolicy, SecurityProfileName } from "./policy.js";
import { SafeLocalPolicy } from "./safe-local.js";
import { VibePolicy } from "./vibe.js";

export function createPolicy(
  profile: SecurityProfileName,
  options: CreatePolicyOptions = {}
): ResolvedSecurityPolicy {
  switch (profile) {
    case "safe-local":
      return {
        policy: new SafeLocalPolicy({
          allowModelApiCall: options.allowModelApiCall ?? false
        }),
        resolution: {
          profile,
          source: "builtin",
          allowRemote: false,
          defaultDeny: false
        }
      };
    case "vibe":
      return {
        policy: new VibePolicy({
          allowModelApiCall: options.allowModelApiCall ?? false
        }),
        resolution: {
          profile,
          source: "builtin",
          allowRemote: false,
          defaultDeny: false
        }
      };
    case "platform": {
      if (!options.workspaceRoot) {
        throw new Error("workspaceRoot is required to resolve the platform policy.");
      }

      const resolution = loadPlatformPolicy({
        workspaceRoot: options.workspaceRoot,
        policyFilePath: options.policyFilePath,
        homeDir: options.homeDir
      });

      return {
        policy: new PlatformPolicy(
          resolution.policyFile ?? {
            schemaVersion: 1
          },
          {
            allowModelApiCall: options.allowModelApiCall ?? false
          }
        ),
        resolution
      };
    }
    default:
      throw new Error(`Unsupported security profile: ${String(profile)}`);
  }
}
