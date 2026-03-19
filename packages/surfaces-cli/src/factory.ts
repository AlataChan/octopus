import { randomUUID } from "node:crypto";

import {
  createMcpActionHandler,
  DefaultMcpSecurityClassifier,
  McpServerManager,
  type McpConfig,
  type McpSecurityClassifier
} from "@octopus/adapter-mcp";
import { ExecutionSubstrate } from "@octopus/exec-substrate";
import type { ActionHandler } from "@octopus/exec-substrate";
import { EventBus, TraceWriter, type WorkEvent } from "@octopus/observability";
import { EmbeddedRuntime, type EmbeddedRuntimeConfig, type ModelClient } from "@octopus/runtime-embedded";
import { createPolicy, type PolicyResolution, type SecurityPolicy, type SecurityProfileName } from "@octopus/security";
import { FileStateStore } from "@octopus/state-store";
import type { ActionType } from "@octopus/work-contracts";
import { WorkEngine } from "@octopus/work-core";
import { GatewayServer, type GatewayConfig } from "@octopus/gateway";

export interface LocalAppConfig {
  workspaceRoot: string;
  dataDir: string;
  runtime: EmbeddedRuntimeConfig;
  profile?: SecurityProfileName;
  policyFilePath?: string;
  gateway?: GatewayConfigSection;
  mcp?: McpConfig;
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

export interface GatewayConfigSection {
  port: number;
  host: string;
  apiKey: string;
  tls?: {
    cert: string;
    key: string;
  };
  trustProxyCIDRs?: string[];
  backfillEventCount?: number;
  wsAuthTimeoutMs?: number;
  tokenSweepIntervalMs?: number;
  allowedOrigins?: string[];
  enableRuntimeProxy?: boolean;
}

export interface GatewayApp extends LocalApp {
  gatewayServer: GatewayServer;
}

interface LocalAppFactoryDependencies {
  createMcpSecurityClassifier?: () => McpSecurityClassifier;
  createMcpServerManager?: (classifier: McpSecurityClassifier) => McpServerManager;
  createMcpActionHandler?: (
    manager: McpServerManager,
    classifier: McpSecurityClassifier,
    eventBus: EventBus
  ) => ActionHandler;
}

export async function createLocalWorkEngine(
  config: LocalAppConfig,
  dependencies: LocalAppFactoryDependencies = {}
): Promise<LocalApp> {
  const eventBus = new EventBus();
  const traceWriter = new TraceWriter(`${config.dataDir}/traces`);
  let traceDrain = Promise.resolve();
  eventBus.onAny((event) => {
    traceDrain = traceDrain.then(() => traceWriter.append(event));
  });
  const runtime = new EmbeddedRuntime(config.runtime, config.modelClient, eventBus);
  const store = new FileStateStore(config.dataDir);
  const { policy, resolution } = createPolicy(config.profile ?? "safe-local", {
    allowModelApiCall: config.runtime.allowModelApiCall,
    workspaceRoot: config.workspaceRoot,
    policyFilePath: config.policyFilePath
  });
  emitPolicyResolutionEvents(eventBus, resolution);
  let mcpManager: McpServerManager | undefined;
  let extensions: Map<ActionType, ActionHandler> | undefined;
  let mcpTools: Array<{
    serverId: string;
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }> | undefined;

  if (config.mcp?.servers.length) {
    const classifier = dependencies.createMcpSecurityClassifier?.() ?? new DefaultMcpSecurityClassifier();
    mcpManager = dependencies.createMcpServerManager?.(classifier) ?? new McpServerManager(classifier);
    await mcpManager.startAll(config.mcp.servers, eventBus);
    const mcpHandler =
      dependencies.createMcpActionHandler?.(mcpManager, classifier, eventBus)
      ?? createMcpActionHandler(mcpManager, classifier, eventBus);
    extensions = new Map<ActionType, ActionHandler>([["mcp-call", mcpHandler]]);
    mcpTools = mcpManager.getAllTools().map((tool) => ({
      serverId: tool.serverId,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  const substrate = new ExecutionSubstrate(extensions);
  const engine = new WorkEngine(runtime, substrate, store, eventBus, policy, {
    ...(mcpTools ? { mcpTools } : {})
  });

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
      await mcpManager?.stopAll();
    }
  };
}

export async function createGatewayApp(
  config: LocalAppConfig & { gateway: GatewayConfigSection },
  dependencies: LocalAppFactoryDependencies = {}
): Promise<GatewayApp> {
  const localApp = await createLocalWorkEngine(config, dependencies);
  const gatewayServer = new GatewayServer(
    toGatewayConfig(config.gateway, config.workspaceRoot),
    localApp.engine,
    localApp.runtime,
    localApp.store,
    localApp.eventBus,
    localApp.policy,
    config.profile ?? "safe-local",
    localApp.policyResolution
  );

  return {
    ...localApp,
    gatewayServer
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

function toGatewayConfig(config: GatewayConfigSection, workspaceRoot: string): GatewayConfig {
  return {
    port: config.port,
    host: config.host,
    workspaceRoot,
    ...(config.tls ? { tls: config.tls } : {}),
    ...(config.trustProxyCIDRs ? { trustProxyCIDRs: [...config.trustProxyCIDRs] } : {}),
    auth: {
      apiKey: config.apiKey,
      defaultPermissions: [
        "sessions.list",
        "sessions.read",
        "sessions.control",
        "sessions.approve",
        "goals.submit",
        "config.read"
      ],
      enableRuntimeProxy: config.enableRuntimeProxy ?? false
    },
    ...(config.backfillEventCount === undefined ? {} : { backfillEventCount: config.backfillEventCount }),
    ...(config.wsAuthTimeoutMs === undefined ? {} : { wsAuthTimeoutMs: config.wsAuthTimeoutMs }),
    ...(config.tokenSweepIntervalMs === undefined ? {} : { tokenSweepIntervalMs: config.tokenSweepIntervalMs }),
    ...(config.allowedOrigins ? { allowedOrigins: [...config.allowedOrigins] } : {})
  };
}
