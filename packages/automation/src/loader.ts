import { readFileSync } from "node:fs";

import type { AutomationConfigFile, AutomationSourceConfig, CronSourceConfig, WatcherSourceConfig } from "./types.js";

export function loadAutomationConfig(configPath: string): AutomationConfigFile {
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const goals = isRecord(parsed.goals) ? parsed.goals : {};
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];

  const typedSources = sources.map(toSourceConfig);
  for (const source of typedSources) {
    if (!(source.namedGoalId in goals)) {
      throw new Error(`Unknown namedGoalId: ${source.namedGoalId}`);
    }
  }

  return {
    goals: Object.fromEntries(
      Object.entries(goals).map(([namedGoalId, value]) => [namedGoalId, toGoalDefinition(namedGoalId, value)])
    ),
    sources: typedSources
  };
}

function toGoalDefinition(namedGoalId: string, value: unknown) {
  if (!isRecord(value) || typeof value.description !== "string" || value.description.trim().length === 0) {
    throw new Error(`Goal ${namedGoalId} must include a non-empty description.`);
  }

  return {
    description: value.description,
    constraints: toStringArray(value.constraints),
    successCriteria: toStringArray(value.successCriteria)
  };
}

function toSourceConfig(value: unknown): AutomationSourceConfig {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.namedGoalId !== "string") {
    throw new Error("Automation source must include type and namedGoalId.");
  }

  if (value.type === "cron") {
    if (typeof value.schedule !== "string" || value.schedule.trim().length === 0) {
      throw new Error(`Cron source ${value.namedGoalId} must include a schedule.`);
    }

    return {
      type: "cron",
      namedGoalId: value.namedGoalId,
      schedule: value.schedule
    } satisfies CronSourceConfig;
  }

  if (value.type === "watcher") {
    if (typeof value.watchPath !== "string" || value.watchPath.trim().length === 0) {
      throw new Error(`Watcher source ${value.namedGoalId} must include watchPath.`);
    }
    const events = toWatcherEvents(value.events);

    return {
      type: "watcher",
      namedGoalId: value.namedGoalId,
      watchPath: value.watchPath,
      events,
      debounceMs: typeof value.debounceMs === "number" ? value.debounceMs : undefined
    } satisfies WatcherSourceConfig;
  }

  throw new Error(`Unsupported automation source type: ${value.type}`);
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function toWatcherEvents(value: unknown): WatcherSourceConfig["events"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Watcher source must include at least one event.");
  }

  const events = value.filter(
    (entry): entry is WatcherSourceConfig["events"][number] =>
      entry === "add" || entry === "change" || entry === "unlink"
  );

  if (events.length === 0) {
    throw new Error("Watcher source must include valid events.");
  }

  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
