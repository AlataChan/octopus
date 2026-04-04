import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import type { EventPayloadByType, SubstrateEventType, WorkEvent } from "@octopus/observability";
import type { Action, ActionResult, ActionType } from "@octopus/work-contracts";

import { resolveExistingWorkspacePath, resolveWorkspacePath } from "./path-utils.js";
import type { ActionHandler, ExecutionSubstratePort, SubstrateContext } from "./types.js";

interface SearchMatch {
  path: string;
  line: number;
  content: string;
}

const BUILT_IN_TYPES: ReadonlySet<ActionType> = new Set(["read", "patch", "shell", "search", "model-call"]);

export class ExecutionSubstrate implements ExecutionSubstratePort {
  constructor(private readonly extensions?: Map<ActionType, ActionHandler>) {
    if (extensions) {
      for (const key of extensions.keys()) {
        if (BUILT_IN_TYPES.has(key)) {
          throw new Error(`Cannot override built-in action type: ${key}`);
        }
      }
    }
  }

  async execute(action: Action, context: SubstrateContext): Promise<ActionResult> {
    switch (action.type) {
      case "read":
        return executeRead(action, context);
      case "patch":
        return executePatch(action, context);
      case "search":
        return executeSearch(action, context);
      case "shell":
        return executeShell(action, context);
      case "model-call":
        throw new Error("model-call is handled by the runtime, not exec-substrate.");
      default: {
        const handler = this.extensions?.get(action.type);
        if (handler) {
          return handler(action, context);
        }
        throw new Error(`Unsupported action type: ${String(action.type)}`);
      }
    }
  }
}

async function executeRead(action: Action, context: SubstrateContext): Promise<ActionResult> {
  const path = getString(action, "path");
  const encoding = getString(action, "encoding", "utf8");
  const resolvedPath = await resolveExistingWorkspacePath(context.workspaceRoot, path);
  const output = await readFile(resolvedPath, encoding as BufferEncoding);

  emitEvent(context, {
    type: "file.read",
    sourceLayer: "substrate",
    payload: {
      path,
      sizeBytes: Buffer.byteLength(output, encoding as BufferEncoding),
      encoding
    }
  });

  return {
    success: true,
    output
  };
}

async function executePatch(action: Action, context: SubstrateContext): Promise<ActionResult> {
  const path = getString(action, "path");
  const content = getString(action, "content");
  const resolvedPath = await resolveWorkspacePath(context.workspaceRoot, path);

  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, "utf8");

  emitEvent(context, {
    type: "file.patched",
    sourceLayer: "substrate",
    payload: {
      path,
      operation: "update",
      bytesWritten: Buffer.byteLength(content, "utf8")
    }
  });

  return {
    success: true,
    output: path
  };
}

async function executeSearch(action: Action, context: SubstrateContext): Promise<ActionResult> {
  const query = getString(action, "query");
  const matches: SearchMatch[] = [];

  for (const filePath of await walkFiles(context.workspaceRoot, context.workspaceRoot)) {
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (line.includes(query)) {
        matches.push({
          path: relative(context.workspaceRoot, filePath),
          line: index + 1,
          content: line
        });
      }
    });
  }

  return {
    success: true,
    output: JSON.stringify(matches)
  };
}

async function executeShell(action: Action, context: SubstrateContext): Promise<ActionResult> {
  const executable = getString(action, "executable");
  const args = getStringArray(action, "args");
  const timeoutMs = getNumber(action, "timeoutMs", 30_000);

  const startedAt = Date.now();
  const child = spawn(executable, args, {
    cwd: context.workspaceRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);

  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(chunk);
    context.onProgress?.("stdout", chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    context.onProgress?.("stderr", chunk.toString("utf8"));
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? (timedOut ? 143 : 1)));
  }).finally(() => {
    clearTimeout(timeout);
  });

  const output = Buffer.concat(stdout).toString("utf8");
  const errorOutput = Buffer.concat(stderr).toString("utf8");

  emitEvent(context, {
    type: "command.executed",
    sourceLayer: "substrate",
    payload: {
      executable,
      args,
      cwd: context.workspaceRoot,
      exitCode,
      durationMs: Date.now() - startedAt,
      timedOut,
      stdout: output || undefined,
      stderr: errorOutput || undefined
    }
  });

  return {
    success: exitCode === 0 && !timedOut,
    output,
    error: errorOutput || undefined,
    timedOut
  };
}

async function walkFiles(root: string, current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function emitEvent(
  context: SubstrateContext,
  partial: {
    type: SubstrateEventType;
    sourceLayer: WorkEvent["sourceLayer"];
    payload: EventPayloadByType[SubstrateEventType];
  } & Partial<WorkEvent>
): void {
  context.eventBus.emit({
    id: randomUUID(),
    timestamp: new Date(),
    sessionId: context.sessionId,
    goalId: context.goalId,
    ...partial
  });
}

function getString(action: Action, key: string, fallback?: string): string {
  const value = action.params[key];
  if (typeof value === "string") {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Expected action.params.${key} to be a string.`);
}

function getStringArray(action: Action, key: string): string[] {
  const value = action.params[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected action.params.${key} to be a string array.`);
  }
  return value as string[];
}

function getNumber(action: Action, key: string, fallback: number): number {
  const value = action.params[key];
  return typeof value === "number" ? value : fallback;
}
