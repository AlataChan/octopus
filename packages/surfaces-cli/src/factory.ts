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
import { createPolicy, type PolicyResolution, type SecurityPolicy, type SecurityProfileName } from "@octopus/security";
import { FileStateStore } from "@octopus/state-store";
import type { ActionType } from "@octopus/work-contracts";
import { WorkEngine } from "@octopus/work-core";
import { EventBus, TraceWriter, type WorkEvent } from "@octopus/observability";
import {
  EmbeddedRuntime,
  HttpModelClient,
  type EmbeddedRuntimeConfig,
  type ModelClient
} from "@octopus/runtime-embedded";
import {
  GatewayServer,
  getPermissionsForRole,
  type GatewayConfig,
  type GatewayPermission,
  type GatewayUserAccount
} from "@octopus/gateway";

export interface LocalAppConfig {
  workspaceRoot: string;
  dataDir: string;
  runtime: EmbeddedRuntimeConfig;
  configIssues?: string[];
  setupMode?: boolean;
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
  users?: GatewayUserAccount[];
  setupToken?: string;
  systemConfigDir?: string;
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

export interface RebuiltRuntimeStack {
  engine: WorkEngine;
  runtime: EmbeddedRuntime;
  policy: SecurityPolicy;
  policyResolution: PolicyResolution;
  auth: {
    apiKey: string;
    users: GatewayUserAccount[];
  };
}

interface HotSwapSystemConfig {
  runtime: {
    provider?: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
  };
  auth: {
    gatewayApiKey: string;
    users: GatewayUserAccount[];
  };
  meta?: {
    initialized: boolean;
    initializedAt: string;
    initializedBy: string;
    schemaVersion: number;
  };
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
  const { mcpManager, extensions, mcpTools } = await createMcpRuntimeState(config, eventBus, dependencies);

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

export async function rebuildRuntimeStack(
  config: LocalAppConfig,
  systemConfig: HotSwapSystemConfig,
  store: FileStateStore,
  eventBus: EventBus,
  dependencies: LocalAppFactoryDependencies = {}
): Promise<RebuiltRuntimeStack> {
  const runtimeConfig: EmbeddedRuntimeConfig = {
    provider: "openai-compatible",
    model: systemConfig.runtime.model,
    apiKey: systemConfig.runtime.apiKey,
    maxTokens: systemConfig.runtime.maxTokens ?? 4_096,
    temperature: systemConfig.runtime.temperature ?? 0,
    ...(systemConfig.runtime.baseUrl ? { baseUrl: systemConfig.runtime.baseUrl } : {}),
    allowModelApiCall: true
  };
  const runtime = new EmbeddedRuntime(runtimeConfig, new HttpModelClient(), eventBus);
  const { policy, resolution } = createPolicy(config.profile ?? "safe-local", {
    allowModelApiCall: runtimeConfig.allowModelApiCall,
    workspaceRoot: config.workspaceRoot,
    policyFilePath: config.policyFilePath
  });
  emitPolicyResolutionEvents(eventBus, resolution);
  const { extensions, mcpTools } = await createMcpRuntimeState(config, eventBus, dependencies);
  const substrate = new ExecutionSubstrate(extensions);
  const engine = new WorkEngine(runtime, substrate, store, eventBus, policy, {
    ...(mcpTools ? { mcpTools } : {})
  });

  return {
    engine,
    runtime,
    policy,
    policyResolution: resolution,
    auth: {
      apiKey: systemConfig.auth.gatewayApiKey,
      users: systemConfig.auth.users.map((user) => ({ ...user }))
    }
  };
}

export async function createGatewayApp(
  config: LocalAppConfig & { gateway: GatewayConfigSection },
  dependencies: LocalAppFactoryDependencies = {}
): Promise<GatewayApp> {
  const localApp = await createLocalWorkEngine(config, dependencies);
  let gatewayServer!: GatewayServer;
  const applyInitializedSystemConfig = async (systemConfig: HotSwapSystemConfig) => {
    const rebuilt = await rebuildRuntimeStack(
      config,
      systemConfig,
      localApp.store,
      localApp.eventBus,
      dependencies
    );
    (
      gatewayServer as GatewayServer & {
        applySystemConfig(update: RebuiltRuntimeStack): void;
      }
    ).applySystemConfig(rebuilt);
  };
  const GatewayServerWithHotSwap = GatewayServer as unknown as {
    new(
      config: GatewayConfig,
      engine: WorkEngine,
      runtime: EmbeddedRuntime,
      store: FileStateStore,
      eventBus: EventBus,
      policy: SecurityPolicy,
      profileName: SecurityProfileName,
      policyResolution: PolicyResolution,
      traceReader?: unknown,
      systemConfigApplier?: (systemConfig: HotSwapSystemConfig) => Promise<void>
    ): GatewayServer;
  };
  gatewayServer = new GatewayServerWithHotSwap(
    toGatewayConfig(config.gateway, config.workspaceRoot, config.setupMode),
    localApp.engine,
    localApp.runtime,
    localApp.store,
    localApp.eventBus,
    localApp.policy,
    config.profile ?? "safe-local",
    localApp.policyResolution,
    undefined,
    applyInitializedSystemConfig
  );

  return {
    ...localApp,
    gatewayServer
  };
}

async function createMcpRuntimeState(
  config: Pick<LocalAppConfig, "mcp">,
  eventBus: EventBus,
  dependencies: LocalAppFactoryDependencies
): Promise<{
  mcpManager?: McpServerManager;
  extensions?: Map<ActionType, ActionHandler>;
  mcpTools?: Array<{
    serverId: string;
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }>;
}> {
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

  return {
    ...(mcpManager ? { mcpManager } : {}),
    ...(extensions ? { extensions } : {}),
    ...(mcpTools ? { mcpTools } : {})
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

function toGatewayConfig(
  config: GatewayConfigSection,
  workspaceRoot: string,
  setupMode = false
): GatewayConfig {
  const defaultPermissions = getPermissionsForRole("admin").filter((permission: GatewayPermission) => (
    config.enableRuntimeProxy ?? false
  ) || permission !== "runtime.proxy");

  return {
    port: config.port,
    host: config.host,
    workspaceRoot,
    ...(config.systemConfigDir ? { systemConfigDir: config.systemConfigDir } : {}),
    ...(config.setupToken ? { setupToken: config.setupToken } : {}),
    ...(setupMode ? { setupMode: true } : {}),
    ...(config.tls ? { tls: config.tls } : {}),
    ...(config.trustProxyCIDRs ? { trustProxyCIDRs: [...config.trustProxyCIDRs] } : {}),
    auth: {
      apiKey: config.apiKey,
      ...(config.users ? { users: [...config.users] } : {}),
      defaultPermissions,
      enableRuntimeProxy: config.enableRuntimeProxy ?? false
    },
    ...(config.backfillEventCount === undefined ? {} : { backfillEventCount: config.backfillEventCount }),
    ...(config.wsAuthTimeoutMs === undefined ? {} : { wsAuthTimeoutMs: config.wsAuthTimeoutMs }),
    ...(config.tokenSweepIntervalMs === undefined ? {} : { tokenSweepIntervalMs: config.tokenSweepIntervalMs }),
    ...(config.allowedOrigins ? { allowedOrigins: [...config.allowedOrigins] } : {})
  };
}
