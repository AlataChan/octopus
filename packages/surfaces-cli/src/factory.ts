import { randomUUID } from "node:crypto";

import { ExecutionSubstrate } from "@octopus/exec-substrate";
import { EventBus, TraceWriter, type WorkEvent } from "@octopus/observability";
import { EmbeddedRuntime, type EmbeddedRuntimeConfig, type ModelClient } from "@octopus/runtime-embedded";
import { createPolicy, type PolicyResolution, type SecurityPolicy, type SecurityProfileName } from "@octopus/security";
import { FileStateStore } from "@octopus/state-store";
import { WorkEngine } from "@octopus/work-core";

export interface LocalAppConfig {
  workspaceRoot: string;
  dataDir: string;
  runtime: EmbeddedRuntimeConfig;
  profile?: SecurityProfileName;
  policyFilePath?: string;
  modelClient: ModelClient;
}

export interface LocalApp {
  engine: WorkEngine;
  eventBus: EventBus;
  runtime: EmbeddedRuntime;
  store: FileStateStore;
  substrate: ExecutionSubstrate;
  policy: SecurityPolicy;
  policyResolution: PolicyResolution;
  flushTraces(): Promise<void>;
}

export function createLocalWorkEngine(config: LocalAppConfig): LocalApp {
  const eventBus = new EventBus();
  const traceWriter = new TraceWriter(`${config.dataDir}/traces`);
  let traceDrain = Promise.resolve();
  eventBus.onAny((event) => {
    traceDrain = traceDrain.then(() => traceWriter.append(event));
  });
  const runtime = new EmbeddedRuntime(config.runtime, config.modelClient, eventBus);
  const store = new FileStateStore(config.dataDir);
  const substrate = new ExecutionSubstrate();
  const { policy, resolution } = createPolicy(config.profile ?? "safe-local", {
    allowModelApiCall: config.runtime.allowModelApiCall,
    workspaceRoot: config.workspaceRoot,
    policyFilePath: config.policyFilePath
  });
  emitPolicyResolutionEvents(eventBus, resolution);
  const engine = new WorkEngine(runtime, substrate, store, eventBus, policy);

  return {
    engine,
    eventBus,
    runtime,
    store,
    substrate,
    policy,
    policyResolution: resolution,
    async flushTraces() {
      await traceDrain;
    }
  };
}

function emitPolicyResolutionEvents(eventBus: EventBus, resolution: PolicyResolution): void {
  eventBus.emit(createPolicyEvent("profile.selected", {
    profile: resolution.profile,
    source: resolution.source
  }));
  eventBus.emit(createPolicyEvent("policy.resolved", {
    profile: resolution.profile,
    source: resolution.source,
    policyFilePath: resolution.policyFilePath,
    allowedExecutables: resolution.allowedExecutables,
    allowNetwork: resolution.allowNetwork,
    allowRemote: resolution.allowRemote,
    defaultDeny: resolution.defaultDeny
  }));
}

function createPolicyEvent<T extends "profile.selected" | "policy.resolved">(
  type: T,
  payload: Extract<WorkEvent, { type: T }>["payload"]
): Extract<WorkEvent, { type: T }> {
  return {
    id: randomUUID(),
    timestamp: new Date(),
    sessionId: "system-policy",
    goalId: "system-policy",
    type,
    sourceLayer: "surface",
    payload
  } as Extract<WorkEvent, { type: T }>;
}
