import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { HttpModelClient } from "@octopus/runtime-embedded";
import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { createPasswordHash } from "../auth.js";
import { isInitialized, isWorkspaceWritable, writeSystemConfig } from "../system-config.js";
import type { SystemConfig } from "../types.js";
import { HttpError, type RouteDeps } from "./shared.js";

const INITIALIZE_LOCKS = new Set<string>();

interface InitializePayload {
  runtime: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  };
  admin: {
    username: string;
    password: string;
  };
  additionalUsers?: Array<{
    username: string;
    password: string;
    role: "operator" | "viewer";
  }>;
}

export async function handleSetupStatus(deps: RouteDeps): Promise<{
  initialized: boolean;
  workspaceWritable: boolean;
}> {
  const configDir = resolveSystemConfigDir(deps);

  return {
    initialized: await isInitialized(configDir),
    workspaceWritable: await isWorkspaceWritable(deps.workspaceRoot)
  };
}

export async function handleValidateToken(deps: RouteDeps): Promise<{ valid: boolean }> {
  await assertNotInitialized(deps);
  return { valid: true };
}

export async function handleValidateRuntime(
  deps: RouteDeps,
  body: unknown
): Promise<{ valid: boolean; latencyMs?: number; error?: string }> {
  await assertNotInitialized(deps);
  const runtime = readRuntimePayload(body);
  const startedAt = Date.now();

  try {
    const client = new HttpModelClient(createTimedFetch(15_000));
    const session = createWorkSession(
      createWorkGoal({
        description: "Validate runtime connectivity"
      })
    );

    await client.completeTurn({
      session,
      results: [],
      config: {
        provider: "openai-compatible",
        model: runtime.model,
        apiKey: runtime.apiKey,
        ...(runtime.baseUrl ? { baseUrl: runtime.baseUrl } : {}),
        maxTokens: 64,
        temperature: 0,
        allowModelApiCall: true
      }
    });

    return {
      valid: true,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      valid: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Runtime validation failed."
    };
  }
}

export async function handleInitialize(
  deps: RouteDeps,
  body: unknown
): Promise<{ initialized: true }> {
  await assertNotInitialized(deps);

  if (!(await isWorkspaceWritable(deps.workspaceRoot))) {
    throw new HttpError(503, "Workspace root is not writable.");
  }

  const payload = readInitializePayload(body);
  const configDir = resolveSystemConfigDir(deps);

  if (INITIALIZE_LOCKS.has(configDir)) {
    throw new HttpError(409, "Initialization is already in progress.");
  }

  INITIALIZE_LOCKS.add(configDir);

  try {
    const runtimeCheck = await handleValidateRuntime(deps, payload.runtime);
    if (!runtimeCheck.valid) {
      throw new HttpError(400, runtimeCheck.error ?? "Runtime validation failed.");
    }

    const users = [
      {
        username: payload.admin.username.trim(),
        passwordHash: await createPasswordHash(payload.admin.password),
        role: "admin" as const
      },
      ...(
        await Promise.all(
          (payload.additionalUsers ?? []).map(async (user) => ({
            username: user.username.trim(),
            passwordHash: await createPasswordHash(user.password),
            role: user.role
          }))
        )
      )
    ];

    const systemConfig: SystemConfig = {
      runtime: {
        provider: "openai-compatible",
        model: payload.runtime.model,
        apiKey: payload.runtime.apiKey,
        ...(payload.runtime.baseUrl ? { baseUrl: payload.runtime.baseUrl } : {}),
        maxTokens: 4_096,
        temperature: 0
      },
      auth: {
        gatewayApiKey: randomUUID(),
        users
      },
      meta: {
        initialized: true,
        initializedAt: new Date().toISOString(),
        initializedBy: payload.admin.username.trim(),
        schemaVersion: 1
      }
    };

    await writeSystemConfig(configDir, systemConfig);
    await deps.systemConfigApplier?.(systemConfig);
    delete process.env.OCTOPUS_SETUP_TOKEN;

    return { initialized: true };
  } finally {
    INITIALIZE_LOCKS.delete(configDir);
  }
}

function resolveSystemConfigDir(deps: RouteDeps): string {
  return deps.config.systemConfigDir ?? join(deps.workspaceRoot, ".octopus", "system");
}

async function assertNotInitialized(deps: RouteDeps): Promise<void> {
  if (await isInitialized(resolveSystemConfigDir(deps))) {
    throw new HttpError(410, "System setup is already complete.");
  }
}

function readRuntimePayload(body: unknown): {
  provider: "openai-compatible";
  model: string;
  apiKey: string;
  baseUrl?: string;
} {
  if (!isRecord(body)) {
    throw new HttpError(400, "Runtime configuration is required.");
  }

  const provider = body.provider;
  const model = readNonEmptyString(body.model, "Runtime model is required.");
  const apiKey = readNonEmptyString(body.apiKey, "Runtime API key is required.");
  const baseUrl = readOptionalString(body.baseUrl);

  if (provider !== "openai-compatible") {
    throw new HttpError(400, "Only openai-compatible runtime configuration is supported.");
  }

  return {
    provider,
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {})
  };
}

function readInitializePayload(body: unknown): InitializePayload {
  if (!isRecord(body) || !isRecord(body.runtime) || !isRecord(body.admin)) {
    throw new HttpError(400, "Initialization payload is required.");
  }

  const runtime = readRuntimePayload(body.runtime);
  const adminUsername = readNonEmptyString(body.admin.username, "Admin username is required.").trim();
  const adminPassword = readPassword(body.admin.password, "Admin password is required.");
  const additionalUsers = readAdditionalUsers(body.additionalUsers);

  return {
    runtime,
    admin: {
      username: adminUsername,
      password: adminPassword
    },
    ...(additionalUsers.length > 0 ? { additionalUsers } : {})
  };
}

function readAdditionalUsers(value: unknown): NonNullable<InitializePayload["additionalUsers"]> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, "additionalUsers must be an array.");
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new HttpError(400, "additionalUsers must contain objects.");
    }

    const username = readNonEmptyString(entry.username, "User username is required.").trim();
    const password = readPassword(entry.password, "User password is required.");
    const role = entry.role;

    if (role !== "operator" && role !== "viewer") {
      throw new HttpError(400, "Additional users must have role operator or viewer.");
    }

    return {
      username,
      password,
      role
    };
  });
}

function readNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, message);
  }
  return value;
}

function readPassword(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, message);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createTimedFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
