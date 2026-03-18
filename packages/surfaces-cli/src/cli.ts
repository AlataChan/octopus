import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { Command } from "commander";

import {
  AutomationDispatcher,
  CronSource,
  WatcherSource,
  loadAutomationConfig,
  type AutomationSource,
  type CronSourceConfig,
  type WatcherSourceConfig
} from "@octopus/automation";
import type { WorkEvent } from "@octopus/observability";
import { TraceReader } from "@octopus/observability";
import { HttpModelClient, type ModelClient } from "@octopus/runtime-embedded";
import type { SecurityProfileName } from "@octopus/security";
import { createWorkGoal } from "@octopus/work-contracts";

import { createLocalWorkEngine, type LocalAppConfig } from "./factory.js";
import { renderReplay } from "./renderer.js";

interface CliDependencies {
  createLocalWorkEngine: typeof createLocalWorkEngine;
  loadAutomationConfig: typeof loadAutomationConfig;
  createCronSource: (config: CronSourceConfig) => AutomationSource;
  createWatcherSource: (config: WatcherSourceConfig) => AutomationSource;
  waitForAutomationStop: () => Promise<void>;
}

const defaultDependencies: CliDependencies = {
  createLocalWorkEngine,
  loadAutomationConfig,
  createCronSource: (config) => new CronSource(config),
  createWatcherSource: (config) => new WatcherSource(config),
  waitForAutomationStop
};

export function buildCli(
  configFactory: () => LocalAppConfig,
  dependencies: CliDependencies = defaultDependencies
): Command {
  const program = new Command();
  program.name("octopus");

  program
    .command("run")
    .argument("<goal>")
    .option("--profile <profile>", "security profile: safe-local, vibe, or platform")
    .option("--policy-file <path>", "platform policy file (implies --profile platform)")
    .action(async (description: string, options: CommandOptions) => {
      const config = applyCommandOverrides(configFactory(), options);
      assertValidConfig(config);
      const app = dependencies.createLocalWorkEngine(config);
      const session = await app.engine.executeGoal(createWorkGoal({ description }), {
        workspaceRoot: config.workspaceRoot
      });
      await app.flushTraces();
      process.stdout.write(`${session.state}\n`);
    });

  program
    .command("restore")
    .argument("<sessionId>")
    .option("--at <timestamp>")
    .option("--profile <profile>", "security profile: safe-local, vibe, or platform")
    .option("--policy-file <path>", "platform policy file (implies --profile platform)")
    .action(async (sessionId: string, options: RestoreOptions) => {
      const config = applyCommandOverrides(configFactory(), options);
      assertValidConfig(config);

      const app = dependencies.createLocalWorkEngine(config);
      const storedSession = await app.store.loadSession(sessionId);
      if (!storedSession) {
        throw new Error(`Unknown session: ${sessionId}`);
      }

      const snapshotId = options.at
        ? selectSnapshotId(await app.store.listSnapshots(sessionId), options.at)
        : undefined;
      const goal = createWorkGoal({
        id: storedSession.goalId,
        namedGoalId: storedSession.namedGoalId,
        description: `Resume session ${sessionId}`
      });

      const session = await app.engine.executeGoal(goal, {
        workspaceRoot: config.workspaceRoot,
        resumeFrom: {
          sessionId,
          ...(snapshotId ? { snapshotId } : {})
        }
      });
      await app.flushTraces();
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
      const app = dependencies.createLocalWorkEngine(configFactory());
      const sessions = await app.store.listSessions();
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    });

  program
    .command("status")
    .argument("[sessionId]")
    .action(async (sessionId?: string) => {
      const app = dependencies.createLocalWorkEngine(configFactory());
      if (!sessionId) {
        const sessions = await app.store.listSessions();
        process.stdout.write(`${JSON.stringify(sessions.at(-1) ?? null, null, 2)}\n`);
        return;
      }

      const session = await app.store.loadSession(sessionId);
      process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    });

  const automationCommand = program.command("automation");
  automationCommand
    .command("run")
    .option("--profile <profile>", "security profile: vibe or platform")
    .option("--policy-file <path>", "platform policy file (implies --profile platform)")
    .action(async (options: CommandOptions) => {
      const config = applyCommandOverrides(configFactory(), options);
      assertAutomationProfile(config.profile ?? "safe-local");
      assertValidConfig(config);

      const app = dependencies.createLocalWorkEngine(config);
      const automationConfig = dependencies.loadAutomationConfig(join(config.dataDir, "automation.json"));
      const dispatcher = new AutomationDispatcher(
        app.store,
        app.engine,
        automationConfig.goals,
        app.eventBus,
        { workspaceRoot: config.workspaceRoot }
      );
      const sources = automationConfig.sources.map((source) => createAutomationSource(source, dependencies));
      let runError: unknown;

      try {
        for (const source of sources) {
          emitAutomationLifecycleEvent(app.eventBus, "automation.source.started", source.namedGoalId, {
            sourceType: source.sourceType,
            namedGoalId: source.namedGoalId
          });
          await source.start(async (event) => {
            await dispatcher.dispatch(event);
          });
        }

        await dependencies.waitForAutomationStop();
      } catch (error) {
        runError = error;
        const message = error instanceof Error ? error.message : "Automation runner failed.";
        for (const source of sources) {
          emitAutomationLifecycleEvent(app.eventBus, "automation.source.failed", source.namedGoalId, {
            sourceType: source.sourceType,
            namedGoalId: source.namedGoalId,
            error: message
          });
        }
      } finally {
        const stopError = await stopAutomationSources(sources, app.eventBus);
        await app.flushTraces();
        runError = mergeAutomationErrors(runError, stopError);
      }

      if (runError) {
        throw runError;
      }
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

function applyCommandOverrides(config: LocalAppConfig, options: CommandOptions): LocalAppConfig {
  const profile = options.profile ? parseProfileOption(options.profile) : config.profile;
  const policyFilePath = options.policyFile ?? config.policyFilePath;

  if (policyFilePath && profile && profile !== "platform") {
    throw new Error("--policy-file requires --profile platform or no --profile");
  }

  return {
    ...config,
    profile: policyFilePath ? "platform" : profile,
    policyFilePath
  };
}

function assertValidConfig(config: LocalAppConfig): void {
  const validationErrors = validateConfig(config);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid Octopus configuration: ${validationErrors.join("; ")}`);
  }
}

function assertAutomationProfile(profile: SecurityProfileName): void {
  if (profile === "safe-local") {
    throw new Error(
      "Automation requires 'vibe' or 'platform' profile.\nCurrent profile: safe-local\nUse: octopus automation run --profile vibe"
    );
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
  profile?: SecurityProfileName;
}

type StoredConfigKey = keyof StoredConfig;

interface CommandOptions {
  profile?: string;
  policyFile?: string;
}

interface RestoreOptions extends CommandOptions {
  at?: string;
}

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
        throw new Error("profile must be one of: safe-local, vibe, platform");
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

function readProfile(value: unknown): SecurityProfileName | undefined {
  return value === "safe-local" || value === "vibe" || value === "platform" ? value : undefined;
}

function parseProfileOption(value: string): SecurityProfileName {
  const profile = readProfile(value);
  if (!profile) {
    throw new Error("profile must be one of: safe-local, vibe, platform");
  }

  return profile;
}

function selectSnapshotId(
  snapshots: Array<{ snapshotId: string; capturedAt: Date }>,
  at: string
): string {
  const target = new Date(at);
  if (Number.isNaN(target.getTime())) {
    throw new Error(`Invalid timestamp: ${at}`);
  }

  const selected = [...snapshots]
    .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())
    .find((snapshot) => snapshot.capturedAt.getTime() <= target.getTime());

  if (!selected) {
    throw new Error(`No snapshot found at or before ${at}`);
  }

  return selected.snapshotId;
}

function createAutomationSource(
  config: CronSourceConfig | WatcherSourceConfig,
  dependencies: CliDependencies
): AutomationSource {
  switch (config.type) {
    case "cron":
      return dependencies.createCronSource(config);
    case "watcher":
      return dependencies.createWatcherSource(config);
    default:
      throw new Error(`Unsupported automation source type: ${String((config as { type?: unknown }).type)}`);
  }
}

function emitAutomationLifecycleEvent<T extends "automation.source.started" | "automation.source.stopped" | "automation.source.failed">(
  eventBus: { emit(event: WorkEvent): void },
  type: T,
  namedGoalId: string,
  payload: Extract<WorkEvent, { type: T }>["payload"]
): void {
  eventBus.emit({
    id: randomUUID(),
    timestamp: new Date(),
    sessionId: `automation:${namedGoalId}`,
    goalId: `automation:${namedGoalId}`,
    type,
    sourceLayer: "automation",
    payload
  } as Extract<WorkEvent, { type: T }>);
}

async function stopAutomationSources(
  sources: AutomationSource[],
  eventBus: { emit(event: WorkEvent): void }
): Promise<Error | undefined> {
  const errors: Error[] = [];

  for (const source of sources) {
    try {
      await source.stop();
      emitAutomationLifecycleEvent(eventBus, "automation.source.stopped", source.namedGoalId, {
        sourceType: source.sourceType,
        namedGoalId: source.namedGoalId,
        reason: "shutdown"
      });
    } catch (error) {
      const stopError = error instanceof Error ? error : new Error("Automation source stop failed.");
      errors.push(stopError);
      emitAutomationLifecycleEvent(eventBus, "automation.source.failed", source.namedGoalId, {
        sourceType: source.sourceType,
        namedGoalId: source.namedGoalId,
        error: stopError.message
      });
    }
  }

  if (errors.length === 0) {
    return undefined;
  }

  return new Error(errors.map((error) => error.message).join("; "));
}

function mergeAutomationErrors(runError: unknown, stopError: Error | undefined): Error | undefined {
  const normalizedRunError = toError(runError);

  if (!normalizedRunError) {
    return stopError;
  }

  if (!stopError) {
    return normalizedRunError;
  }

  return new Error(`${normalizedRunError.message}; shutdown errors: ${stopError.message}`, {
    cause: {
      runError: normalizedRunError,
      stopError
    }
  });
}

function toError(error: unknown): Error | undefined {
  if (error === undefined || error === null) {
    return undefined;
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

async function waitForAutomationStop(): Promise<void> {
  await new Promise<void>((resolve) => {
    const handleStop = () => {
      process.off("SIGINT", handleStop);
      process.off("SIGTERM", handleStop);
      resolve();
    };

    process.on("SIGINT", handleStop);
    process.on("SIGTERM", handleStop);
  });
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
