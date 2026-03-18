import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import type { PolicyFile, PolicyResolution } from "./policy.js";

export interface PlatformLoaderOptions {
  workspaceRoot: string;
  policyFilePath?: string;
  homeDir?: string;
}

export interface LoadedPlatformPolicy extends PolicyResolution {
  policyFile?: PolicyFile;
}

export function loadPlatformPolicy(options: PlatformLoaderOptions): LoadedPlatformPolicy {
  const explicitPath = options.policyFilePath;
  if (explicitPath) {
    if (!isAbsolute(explicitPath)) {
      throw new Error(`Platform policy path must be absolute: ${explicitPath}`);
    }

    const resolved = assertTrustedPolicyPath(explicitPath, options.workspaceRoot);
    return buildResolution("flag", resolved, readPolicyFile(resolved));
  }

  const homeDir = options.homeDir ?? homedir();
  const globalPath = join(homeDir, ".octopus", "policy.json");
  if (existsSync(globalPath)) {
    const resolved = assertTrustedPolicyPath(globalPath, options.workspaceRoot);
    return buildResolution("global", resolved, readPolicyFile(resolved));
  }

  return {
    profile: "platform",
    source: "default-deny",
    defaultDeny: true
  };
}

function buildResolution(
  source: "flag" | "global",
  policyFilePath: string,
  policyFile: PolicyFile
): LoadedPlatformPolicy {
  return {
    profile: "platform",
    source,
    policyFilePath,
    allowedExecutables: policyFile.allowedExecutables,
    allowNetwork: policyFile.allowNetwork,
    allowRemote: policyFile.allowRemote,
    defaultDeny: false,
    policyFile
  };
}

function assertTrustedPolicyPath(candidatePath: string, workspaceRoot: string): string {
  const resolvedCandidate = realpathSync(candidatePath);
  const resolvedWorkspace = realpathSync(workspaceRoot);
  const candidateRelative = relative(resolvedWorkspace, resolvedCandidate);

  if (candidateRelative.length === 0 || (!candidateRelative.startsWith("..") && candidateRelative !== ".")) {
    throw new Error(`Policy file inside workspace is not trusted for platform profile: ${candidatePath}`);
  }

  return resolvedCandidate;
}

function readPolicyFile(path: string): PolicyFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const allowedExecutables = Array.isArray(parsed.allowedExecutables)
    ? parsed.allowedExecutables.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return {
    schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
    allowedExecutables,
    allowNetwork: parsed.allowNetwork === true,
    allowRemote: parsed.allowRemote === true
  };
}
