import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import type { Artifact } from "@octopus/work-contracts";

import type { OperatorContext } from "../types.js";
import { HttpError, assertPermission, type RouteDeps } from "./shared.js";

const previewableTypes = new Set<Artifact["type"]>([
  "code",
  "script",
  "report",
  "patch",
  "document",
  "runbook"
]);

export async function handleGetArtifactContent(
  deps: RouteDeps,
  operator: OperatorContext,
  sessionId: string,
  requestedPath: string | null
) {
  assertPermission(operator, "sessions.read");

  const nextPath = requestedPath?.trim();
  if (!nextPath) {
    throw new HttpError(400, "Artifact path is required.");
  }

  const session = await deps.store.loadSession(sessionId);
  if (!session) {
    throw new HttpError(404, `Unknown session: ${sessionId}`);
  }

  const artifact = session.artifacts.find((entry) => entry.path === nextPath);
  if (!artifact) {
    throw new HttpError(404, `Unknown artifact for session: ${nextPath}`);
  }

  if (!previewableTypes.has(artifact.type)) {
    throw new HttpError(400, `Artifact type is not previewable: ${artifact.type}`);
  }

  const filePath = resolveWorkspacePath(deps.workspaceRoot, artifact.path);

  try {
    return {
      path: artifact.path,
      type: artifact.type,
      contentType: inferContentType(artifact.path),
      content: await readFile(filePath, "utf8")
    };
  } catch (error) {
    if (isMissing(error)) {
      throw new HttpError(404, `Artifact content not found: ${artifact.path}`);
    }
    throw error;
  }
}

function resolveWorkspacePath(workspaceRoot: string, candidatePath: string): string {
  const resolvedRoot = resolve(workspaceRoot);
  const resolvedPath = resolve(resolvedRoot, candidatePath);
  const relativePath = relative(resolvedRoot, resolvedPath);

  if (relativePath.startsWith("..")) {
    throw new HttpError(400, `Artifact path escapes workspace: ${candidatePath}`);
  }

  return resolvedPath;
}

function inferContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".md") {
    return "text/markdown; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function isMissing(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ENOENT";
}
