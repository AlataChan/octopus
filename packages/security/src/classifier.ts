import path from "node:path";

import type { RiskLevel } from "./policy.js";

const DANGEROUS_EXECUTABLES = new Set(["rm", "rmdir", "dd", "mkfs", "shutdown", "reboot", "kill", "pkill"]);
const SAFE_READONLY_EXECUTABLES = new Set(["pwd", "ls", "cat", "rg", "find"]);
const SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "rev-parse", "grep"]);

export function classifyShellRisk(executable: string, args: string[]): RiskLevel {
  if (DANGEROUS_EXECUTABLES.has(executable)) {
    return "dangerous";
  }

  if (args.some((arg) => path.isAbsolute(arg))) {
    return "consequential";
  }

  if (SAFE_READONLY_EXECUTABLES.has(executable)) {
    return "safe";
  }

  if (executable === "git" && args.length > 0 && SAFE_GIT_SUBCOMMANDS.has(args[0] ?? "")) {
    return "safe";
  }

  return "consequential";
}

export function createShellApprovalKey(executable: string, args: string[]): string {
  const normalizedArgs = args.join(" ").trim();
  return normalizedArgs.length > 0 ? `shell:${executable} ${normalizedArgs}` : `shell:${executable}`;
}

