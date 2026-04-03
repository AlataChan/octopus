import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { SystemAuthConfig, SystemConfig, SystemMeta, SystemRuntimeConfig } from "./types.js";

export async function readSystemConfig(configDir: string): Promise<SystemConfig | null> {
  const [meta, runtime, auth] = await Promise.all([
    readJsonFile<SystemMeta>(join(configDir, "meta.json")),
    readJsonFile<SystemRuntimeConfig>(join(configDir, "runtime.json")),
    readJsonFile<SystemAuthConfig>(join(configDir, "auth.json"))
  ]);

  if (!meta || !runtime || !auth) {
    return null;
  }

  return {
    runtime,
    auth,
    meta
  };
}

export async function writeSystemConfig(configDir: string, config: SystemConfig): Promise<void> {
  await mkdir(configDir, { recursive: true });

  await Promise.all([
    writeJsonAtomically(join(configDir, "meta.json"), config.meta),
    writeJsonAtomically(join(configDir, "runtime.json"), config.runtime),
    writeJsonAtomically(join(configDir, "auth.json"), config.auth)
  ]);
}

export async function isInitialized(configDir: string): Promise<boolean> {
  const meta = await readJsonFile<SystemMeta>(join(configDir, "meta.json"));
  return meta?.initialized === true;
}

export async function isWorkspaceWritable(workspaceRoot: string): Promise<boolean> {
  try {
    const info = await stat(workspaceRoot);
    if (!info.isDirectory()) {
      return false;
    }

    const probePath = join(workspaceRoot, `.octopus-write-test-${randomUUID()}`);
    await writeFile(probePath, "", "utf8");
    await rm(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
