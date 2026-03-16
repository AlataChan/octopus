import { ExecutionSubstrate } from "@octopus/exec-substrate";
import { EventBus } from "@octopus/observability";
import { EmbeddedRuntime, type EmbeddedRuntimeConfig, type ModelClient } from "@octopus/runtime-embedded";
import { SafeLocalPolicy } from "@octopus/security";
import { FileStateStore } from "@octopus/state-store";
import { WorkEngine } from "@octopus/work-core";

export interface LocalAppConfig {
  workspaceRoot: string;
  dataDir: string;
  runtime: EmbeddedRuntimeConfig;
  profile?: string;
  modelClient: ModelClient;
}

export interface LocalApp {
  engine: WorkEngine;
  eventBus: EventBus;
  runtime: EmbeddedRuntime;
  store: FileStateStore;
  substrate: ExecutionSubstrate;
  policy: SafeLocalPolicy;
}

export function createLocalWorkEngine(config: LocalAppConfig): LocalApp {
  const eventBus = new EventBus();
  const runtime = new EmbeddedRuntime(config.runtime, config.modelClient, eventBus);
  const store = new FileStateStore(config.dataDir);
  const substrate = new ExecutionSubstrate();
  const policy = new SafeLocalPolicy({
    allowModelApiCall: config.runtime.allowModelApiCall
  });
  const engine = new WorkEngine(runtime, substrate, store, eventBus, policy);

  return {
    engine,
    eventBus,
    runtime,
    store,
    substrate,
    policy
  };
}
