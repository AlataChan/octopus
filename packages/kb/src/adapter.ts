import { createHash, randomUUID } from "node:crypto";
import { spawn as defaultSpawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

import type { EventBus, WorkEvent } from "@octopus/observability";
import { ZodError } from "zod";

import { KbAdapterError } from "./errors.js";
import type { KbPort } from "./port.js";
import {
  KB_SCHEMA_HASHES,
  parseKbImpactedPagesResult,
  parseKbLookupResult,
  parseKbNeighborsResult,
  parseKbRetrieveBundleResult,
} from "./schemas.js";
import type {
  KbAvailability,
  KbCommand,
  KbImpactedPagesInput,
  KbLookupInput,
  KbNeighborsInput,
  KbRawImpactedPagesResult,
  KbRawLookupResult,
  KbRawNeighborsResult,
  KbRawRetrieveBundleResult,
  KbRetrieveBundleInput,
} from "./types.js";

type SpawnFn = (command: string, args: readonly string[], options?: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

export interface KbAdapterTraceContext {
  sessionId: string;
  goalId: string;
}

export interface SubprocessKbPortOptions {
  executable?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  eventBus?: EventBus;
  traceContext?: KbAdapterTraceContext;
}

export function createSubprocessKbPort(options: SubprocessKbPortOptions = {}): KbPort {
  return new SubprocessKbPort(options);
}

class SubprocessKbPort implements KbPort {
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private versionCache: string | "unknown" | undefined;
  private versionPromise: Promise<string | "unknown"> | undefined;

  constructor(private readonly options: SubprocessKbPortOptions) {
    this.executable = options.executable ?? "octopus-kb";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.spawnFn = options.spawn ?? defaultSpawn;
  }

  async available(): Promise<KbAvailability> {
    try {
      await runProcess(this.spawnFn, this.executable, ["--help"], this.timeoutMs);
      return { ok: true, version: await this.getVersion() };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "octopus-kb is unavailable" };
    }
  }

  async lookup(input: KbLookupInput): Promise<KbRawLookupResult> {
    return this.runJson(
      "lookup",
      ["lookup", input.term, "--vault", input.vaultPath, "--json"],
      parseKbLookupResult,
      { vaultPath: input.vaultPath, query: input.term }
    );
  }

  async retrieveBundle(input: KbRetrieveBundleInput): Promise<KbRawRetrieveBundleResult> {
    const args = ["retrieve-bundle", input.query, "--vault", input.vaultPath, "--json"];
    if (input.maxTokens !== undefined) {
      args.push("--max-tokens", String(input.maxTokens));
    }
    return this.runJson("retrieve-bundle", args, parseKbRetrieveBundleResult, {
      vaultPath: input.vaultPath,
      query: input.query,
    });
  }

  async neighbors(input: KbNeighborsInput): Promise<KbRawNeighborsResult> {
    return this.runJson(
      "neighbors",
      ["neighbors", input.pagePath, "--vault", input.vaultPath, "--json"],
      parseKbNeighborsResult,
      { vaultPath: input.vaultPath, query: input.pagePath }
    );
  }

  async impactedPages(input: KbImpactedPagesInput): Promise<KbRawImpactedPagesResult> {
    return this.runJson(
      "impacted-pages",
      ["impacted-pages", input.pagePath, "--vault", input.vaultPath, "--json"],
      parseKbImpactedPagesResult,
      { vaultPath: input.vaultPath, query: input.pagePath }
    );
  }

  private async runJson<T>(
    command: KbCommand,
    args: string[],
    parse: (input: unknown) => T,
    hashes: { vaultPath: string; query?: string }
  ): Promise<T> {
    const startedAt = Date.now();
    this.emit("kb.adapter.call.started", {
      command,
      vaultPathHash: hashValue(hashes.vaultPath),
      ...(hashes.query !== undefined ? { queryHash: hashValue(hashes.query) } : {}),
    });

    try {
      const output = await runProcess(this.spawnFn, this.executable, args, this.timeoutMs);
      const parsedJson = JSON.parse(output.stdout) as unknown;
      const result = parse(parsedJson);
      this.emit("kb.adapter.call.completed", {
        command,
        durationMs: Date.now() - startedAt,
        octopusKbVersion: await this.getVersion(),
        schemaHash: KB_SCHEMA_HASHES[command],
        resultItemCount: countResultItems(command, result),
      });
      return result;
    } catch (error) {
      const adapterError = toAdapterError(error);
      this.emit("kb.adapter.call.failed", {
        command,
        durationMs: Date.now() - startedAt,
        errorKind: adapterError.kind,
        message: adapterError.message,
      });
      throw adapterError;
    }
  }

  private async getVersion(): Promise<string | "unknown"> {
    if (this.versionCache !== undefined) {
      return this.versionCache;
    }
    this.versionPromise ??= probeVersion(this.spawnFn, this.timeoutMs);
    this.versionCache = await this.versionPromise;
    return this.versionCache;
  }

  private emit<T extends WorkEvent["type"]>(type: T, payload: Extract<WorkEvent, { type: T }>["payload"]): void {
    if (!this.options.eventBus || !this.options.traceContext) {
      return;
    }
    this.options.eventBus.emit({
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: this.options.traceContext.sessionId,
      goalId: this.options.traceContext.goalId,
      type,
      sourceLayer: "work-core",
      payload,
    } as Extract<WorkEvent, { type: T }>);
  }
}

async function probeVersion(spawnFn: SpawnFn, timeoutMs: number): Promise<string | "unknown"> {
  try {
    const pip = await runProcess(spawnFn, "python3", ["-m", "pip", "show", "octopus-kb"], timeoutMs);
    const versionLine = pip.stdout.split("\n").find((line) => line.startsWith("Version:"));
    const version = versionLine?.slice("Version:".length).trim();
    if (version) {
      return version;
    }
  } catch {
    // Fall through to importlib metadata.
  }

  try {
    const metadata = await runProcess(
      spawnFn,
      "python3",
      ["-c", "import importlib.metadata; print(importlib.metadata.version('octopus-kb'))"],
      timeoutMs
    );
    return metadata.stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function runProcess(
  spawnFn: SpawnFn,
  command: string,
  args: readonly string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(command, args);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new KbAdapterError("timeout", `${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new KbAdapterError("not_installed", `${command} is not available`, error));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new KbAdapterError("command_failed", stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function toAdapterError(error: unknown): KbAdapterError {
  if (error instanceof KbAdapterError) {
    return error;
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return new KbAdapterError("schema_drift", error.message, error);
  }
  return new KbAdapterError("command_failed", error instanceof Error ? error.message : "octopus-kb command failed", error);
}

function countResultItems(command: KbCommand, result: unknown): number {
  switch (command) {
    case "lookup": {
      const lookup = result as KbRawLookupResult;
      return (lookup.canonical ? 1 : 0) + lookup.aliases.length + lookup.collisions.length;
    }
    case "retrieve-bundle": {
      const bundle = (result as KbRawRetrieveBundleResult).bundle;
      return bundle.schema.length + bundle.index.length + bundle.concepts.length + bundle.entities.length + bundle.raw_sources.length;
    }
    case "neighbors": {
      const neighbors = result as KbRawNeighborsResult;
      return neighbors.inbound.length + neighbors.outbound.length;
    }
    case "impacted-pages":
      return (result as KbRawImpactedPagesResult).impacted.length;
  }
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
