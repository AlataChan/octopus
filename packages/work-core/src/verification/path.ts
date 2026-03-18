import { relative, resolve } from "node:path";

export function resolveWorkspacePath(workspaceRoot: string, candidatePath: string): string {
  if (candidatePath.trim().length === 0) {
    throw new Error("Verification path must not be empty.");
  }

  const resolvedRoot = resolve(workspaceRoot);
  const resolvedPath = resolve(resolvedRoot, candidatePath);
  const relativePath = relative(resolvedRoot, resolvedPath);

  if (relativePath.length === 0 || relativePath.startsWith("..")) {
    throw new Error(`Verification path escapes workspace: ${candidatePath}`);
  }

  return resolvedPath;
}
