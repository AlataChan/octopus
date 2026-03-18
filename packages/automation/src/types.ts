export interface NamedGoalDefinition {
  description: string;
  constraints?: string[];
  successCriteria?: string[];
}

export type NamedGoalRegistry = Record<string, NamedGoalDefinition>;

export type AutomationSourceType = "cron" | "watcher";

export interface AutomationEvent {
  sourceType: AutomationSourceType;
  namedGoalId: string;
  triggeredAt: Date;
  payload?: Record<string, unknown>;
}

export interface AutomationSource {
  readonly name: string;
  readonly sourceType: AutomationSourceType;
  readonly namedGoalId: string;
  start(onEvent: (event: AutomationEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface CronSourceConfig {
  type: "cron";
  namedGoalId: string;
  schedule: string;
}

export interface WatcherSourceConfig {
  type: "watcher";
  namedGoalId: string;
  watchPath: string;
  events: Array<"add" | "change" | "unlink">;
  debounceMs?: number;
}

export type AutomationSourceConfig = CronSourceConfig | WatcherSourceConfig;

export interface AutomationConfigFile {
  goals: NamedGoalRegistry;
  sources: AutomationSourceConfig[];
}
