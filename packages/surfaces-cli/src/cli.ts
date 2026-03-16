import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Command } from "commander";

import { TraceReader } from "@octopus/observability";
import { HttpModelClient, type ModelClient } from "@octopus/runtime-embedded";
import { createWorkGoal } from "@octopus/work-contracts";

import { createLocalWorkEngine, type LocalAppConfig } from "./factory.js";
import { renderReplay } from "./renderer.js";

export function buildCli(configFactory: () => LocalAppConfig): Command {
  const program = new Command();
  program.name("octopus");

  program
    .command("run")
    .argument("<goal>")
    .action(async (description: string) => {
      const config = configFactory();
      assertValidConfig(config);
      const app = createLocalWorkEngine(config);
      const session = await app.engine.executeGoal(createWorkGoal({ description }), {
        workspaceRoot: config.workspaceRoot
      });
      process.stdout.write(`${session.state}\n`);
    });

  program
    .command("replay")
    .argument("<sessionId>")
    .action(async (sessionId: string) => {
      const config = configFactory();
      const reader = new TraceReader(join(config.dataDir, "traces"));
      const events = await reader.read(sessionId);
      process.stdout.write(`${renderReplay(events)}\n`);
    });

  program
    .command("sessions")
    .action(async () => {
      const app = createLocalWorkEngine(configFactory());
      const sessions = await app.store.listSessions();
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    });

  program
    .command("status")
    .argument("[sessionId]")
    .action(async (sessionId?: string) => {
      const app = createLocalWorkEngine(configFactory());
      if (!sessionId) {
        const sessions = await app.store.listSessions();
        process.stdout.write(`${JSON.stringify(sessions.at(-1) ?? null, null, 2)}\n`);
        return;
      }

      const session = await app.store.loadSession(sessionId);
      process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    });

  const configCommand = program
    .command("config")
    .action(async () => {
      const config = configFactory();
      process.stdout.write(`${JSON.stringify(describeConfig(config), null, 2)}\n`);
    });

  configCommand
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .action(async (key: string, value: string) => {
      const config = configFactory();
      const configPath = join(config.dataDir, "config.json");
      const { key: updatedKey, storedConfig, displayValue } = await setConfigValue(configPath, key, value);
      process.stdout.write(
        `${JSON.stringify({ updatedKey, configPath, storedValue: displayValue, config: sanitizeStoredConfig(storedConfig) }, null, 2)}\n`
      );
    });

  return program;
}

export async function main(): Promise<void> {
  const program = buildCli(() => createDefaultConfig(process.cwd(), new HttpModelClient()));
  await program.parseAsync(process.argv);
}

function createDefaultConfig(workspaceRoot: string, modelClient: ModelClient): LocalAppConfig {
  const dataDir = join(workspaceRoot, ".octopus");
  const fileConfig = readFileConfig(join(dataDir, "config.json"));

  return {
    workspaceRoot,
    dataDir,
    runtime: {
      provider: readProvider(process.env.OCTOPUS_PROVIDER) ?? fileConfig.provider ?? "anthropic",
      model: process.env.OCTOPUS_MODEL ?? fileConfig.model ?? "claude-sonnet-4-6",
      apiKey: process.env.OCTOPUS_API_KEY ?? fileConfig.apiKey ?? "",
      maxTokens: readNumber(process.env.OCTOPUS_MAX_TOKENS) ?? fileConfig.maxTokens ?? 4_096,
      temperature: readNumber(process.env.OCTOPUS_TEMPERATURE) ?? fileConfig.temperature ?? 0,
      baseUrl: process.env.OCTOPUS_BASE_URL ?? fileConfig.baseUrl,
      allowModelApiCall: readBoolean(process.env.OCTOPUS_ALLOW_MODEL_API_CALL) ?? fileConfig.allowModelApiCall ?? false
    },
    profile: readProfile(process.env.OCTOPUS_PROFILE) ?? fileConfig.profile ?? "safe-local",
    modelClient
  };
}

function describeConfig(config: LocalAppConfig) {
  return {
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    runtime: {
      provider: config.runtime.provider,
      model: config.runtime.model,
      baseUrl: config.runtime.baseUrl ?? null,
      maxTokens: config.runtime.maxTokens,
      temperature: config.runtime.temperature,
      allowModelApiCall: config.runtime.allowModelApiCall,
      apiKeyConfigured: config.runtime.apiKey.trim().length > 0
    },
    profile: config.profile ?? "safe-local",
    validationErrors: validateConfig(config)
  };
}

function assertValidConfig(config: LocalAppConfig): void {
  const validationErrors = validateConfig(config);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid Octopus configuration: ${validationErrors.join("; ")}`);
  }
}

function validateConfig(config: LocalAppConfig): string[] {
  const errors: string[] = [];

  if (config.runtime.model.trim().length === 0) {
    errors.push("runtime.model must be configured");
  }
  if (config.runtime.apiKey.trim().length === 0) {
    errors.push("runtime.apiKey must be configured");
  }
  if (!config.runtime.allowModelApiCall) {
    errors.push("runtime.allowModelApiCall must be true to run the embedded runtime");
  }
  if ((config.profile ?? "safe-local") !== "safe-local") {
    errors.push("profile must be safe-local in Phase 1");
  }

  return errors;
}

interface StoredConfig {
  provider?: LocalAppConfig["runtime"]["provider"];
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
  allowModelApiCall?: boolean;
  profile?: string;
}

type StoredConfigKey = keyof StoredConfig;

function readFileConfig(path: string): StoredConfig {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      provider: readProvider(parsed.provider),
      model: readString(parsed.model),
      apiKey: readString(parsed.apiKey),
      maxTokens: typeof parsed.maxTokens === "number" ? parsed.maxTokens : undefined,
      temperature: typeof parsed.temperature === "number" ? parsed.temperature : undefined,
      baseUrl: readString(parsed.baseUrl),
      allowModelApiCall: typeof parsed.allowModelApiCall === "boolean" ? parsed.allowModelApiCall : undefined,
      profile: readProfile(parsed.profile)
    };
  } catch {
    return {};
  }
}

async function setConfigValue(
  configPath: string,
  key: string,
  rawValue: string
): Promise<{ key: StoredConfigKey; storedConfig: StoredConfig; displayValue: string | number | boolean }> {
  const parsed = parseConfigKeyValue(key, rawValue);
  const current = readFileConfig(configPath);
  const next: StoredConfig = {
    ...current,
    [parsed.key]: parsed.value
  };

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return {
    key: parsed.key,
    storedConfig: next,
    displayValue: parsed.key === "apiKey" ? "[redacted]" : parsed.value
  };
}

function parseConfigKeyValue(
  key: string,
  rawValue: string
): { key: StoredConfigKey; value: string | number | boolean } {
  switch (key) {
    case "apiKey":
      return { key, value: rawValue };
    case "model":
      return { key, value: requireNonEmptyString(rawValue, "model") };
    case "provider": {
      const provider = readProvider(rawValue);
      if (!provider) {
        throw new Error("provider must be one of: anthropic, openai-compatible");
      }
      return { key, value: provider };
    }
    case "baseUrl":
      return { key, value: requireNonEmptyString(rawValue, "baseUrl") };
    case "maxTokens": {
      const value = readNumber(rawValue);
      if (value === undefined || !Number.isInteger(value) || value <= 0) {
        throw new Error("maxTokens must be a positive integer");
      }
      return { key, value };
    }
    case "temperature": {
      const value = readNumber(rawValue);
      if (value === undefined) {
        throw new Error("temperature must be a finite number");
      }
      return { key, value };
    }
    case "allowModelApiCall": {
      const value = readBoolean(rawValue);
      if (value === undefined) {
        throw new Error("allowModelApiCall must be true or false");
      }
      return { key, value };
    }
    case "profile": {
      const profile = readProfile(rawValue);
      if (!profile) {
        throw new Error("profile must be safe-local in Phase 1");
      }
      return { key, value: profile };
    }
    default:
      throw new Error("Unsupported config key. Allowed keys: apiKey, model, provider, baseUrl, maxTokens, temperature, allowModelApiCall, profile");
  }
}

function sanitizeStoredConfig(config: StoredConfig) {
  return {
    ...config,
    apiKey: config.apiKey ? "[redacted]" : config.apiKey
  };
}

function readProvider(value: unknown): LocalAppConfig["runtime"]["provider"] | undefined {
  return value === "anthropic" || value === "openai-compatible" ? value : undefined;
}

function readProfile(value: unknown): string | undefined {
  return value === "safe-local" ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requireNonEmptyString(value: string, key: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
