import { realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export async function resolveWorkspacePath(workspaceRoot: string, inputPath: string): Promise<string> {
  const root = await realpath(workspaceRoot);
  const candidate = resolve(root, inputPath);
  const candidateParent = await realpath(dirname(candidate));

  if (!isWithinRoot(root, candidate) || !isWithinRoot(root, candidateParent)) {
    throw new Error(`Path escapes workspace boundary: ${inputPath}`);
  }

  return candidate;
}

export async function resolveExistingWorkspacePath(
  workspaceRoot: string,
  inputPath: string
): Promise<string> {
  const root = await realpath(workspaceRoot);
  const candidate = resolve(root, inputPath);

  if (!isWithinRoot(root, candidate)) {
    throw new Error(`Path escapes workspace boundary: ${inputPath}`);
  }

  const realCandidate = await realpath(candidate);

  if (!isWithinRoot(root, realCandidate)) {
    throw new Error(`Path escapes workspace boundary: ${inputPath}`);
  }

  return realCandidate;
}

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
