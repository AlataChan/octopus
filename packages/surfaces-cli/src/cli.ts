import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { Command } from "commander";

import {
  DefaultMcpSecurityClassifier,
  McpServerManager,
  type McpSecurityClassifier,
  type McpToolDefinition
} from "@octopus/adapter-mcp";
import {
  AutomationDispatcher,
  CronSource,
  WatcherSource,
  loadAutomationConfig,
  type AutomationSource,
  type CronSourceConfig,
  type WatcherSourceConfig
} from "@octopus/automation";
import { EventBus, type WorkEvent } from "@octopus/observability";
import { TraceReader } from "@octopus/observability";
import { HttpModelClient, type ModelClient } from "@octopus/runtime-embedded";
import type { SecurityProfileName } from "@octopus/security";
import { createWorkGoal } from "@octopus/work-contracts";
import { EvalRunner, buildReport, listReports, loadEvalSuite, loadReport, saveReport } from "@octopus/eval-runner";
import { loadBuiltinPacks, loadCustomPacks, resolveGoal, validateParams } from "@octopus/work-packs";

import {
  createGatewayApp,
  createLocalWorkEngine,
  type GatewayApp,
  type GatewayConfigSection,
  type LocalApp,
  type LocalAppConfig
} from "./factory.js";
import { RemoteClient, type ApprovalRequestedMessage, type RemoteAttachHandle, type RemoteClientConfig } from "./remote-client.js";
import { renderReplay } from "./renderer.js";

interface RemoteClientLike {
  listSessions(): Promise<unknown[]>;
  getSession(sessionId: string): Promise<unknown>;
  submitGoal(description: string): Promise<{ sessionId: string; goalId: string; state: string }>;
  controlSession(sessionId: string, action: "pause" | "cancel" | "resume"): Promise<void>;
  approveSession(sessionId: string, promptId: string, action: "approve" | "deny"): Promise<void>;
  mintToken(): Promise<{ token: string; expiresAt: string }>;
  attachToSession(
    sessionId: string,
    onEvent: (event: WorkEvent) => void,
    onClose: (reason: string) => void,
    onApprovalRequested?: (message: ApprovalRequestedMessage) => void
  ): Promise<RemoteAttachHandle>;
}

interface CliDependencies {
  createLocalWorkEngine: (
    config: LocalAppConfig
  ) => LocalApp | Promise<LocalApp>;
  createGatewayApp: (
    config: LocalAppConfig & { gateway: GatewayConfigSection }
  ) => GatewayApp | Promise<GatewayApp>;
  createRemoteClient: (config: RemoteClientConfig) => RemoteClientLike;
  loadAutomationConfig: typeof loadAutomationConfig;
  createCronSource: (config: CronSourceConfig) => AutomationSource;
  createWatcherSource: (config: WatcherSourceConfig) => AutomationSource;
  waitForAutomationStop: () => Promise<void>;
  waitForGatewayStop: () => Promise<void>;
  createMcpSecurityClassifier: () => McpSecurityClassifier;
  createMcpServerManager: (classifier: McpSecurityClassifier) => McpServerManager;
}

const defaultDependencies: CliDependencies = {
  createLocalWorkEngine,
  createGatewayApp,
  createRemoteClient: (config) => new RemoteClient(config),
  loadAutomationConfig,
  createCronSource: (config) => new CronSource(config),
  createWatcherSource: (config) => new WatcherSource(config),
  waitForAutomationStop,
  waitForGatewayStop,
  createMcpSecurityClassifier: () => new DefaultMcpSecurityClassifier(),
  createMcpServerManager: (classifier) => new McpServerManager(classifier)
};

export function buildCli(
  configFactory: () => LocalAppConfig,
  dependencies: Partial<CliDependencies> = {}
): Command {
  const resolvedDependencies: CliDependencies = {
    ...defaultDependencies,
    ...dependencies
  };
  const program = new Command();
  program.name("octopus");
  program.description("Octopus — AI work agent that executes goals autonomously");

  // Default action: when running `octopus` with no arguments
  program.action(() => {
    const config = configFactory();
    const errors = validateConfig(config);
    if (errors.length > 0) {
      process.stdout.write("\n  Octopus is not configured yet.\n\n");
      process.stdout.write("  Run the setup wizard:\n\n");
      process.stdout.write("    octopus init\n\n");
      process.stdout.write("  Or configure manually:\n\n");
      process.stdout.write("    octopus config set model <model-name>\n");
      process.stdout.write("    octopus config set apiKey <your-api-key>\n");
      process.stdout.write("    octopus config set baseUrl <api-endpoint>\n");
      process.stdout.write("    octopus config set allowModelApiCall true\n\n");
    } else {
      program.outputHelp();
    }
  });

  program
    .command("init")
    .description("Interactive setup wizard")
    .action(async () => {
      const config = configFactory();
      const configPath = join(config.dataDir, "config.json");

      process.stdout.write("\n  Welcome to Octopus!\n\n");
      process.stdout.write("  Let's configure your AI model connection.\n\n");

      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        const baseUrl = await rl.question("  API Base URL (e.g. https://api.openai.com/v1): ");
        const model = await rl.question("  Model name (e.g. gpt-4o, claude-sonnet-4-6): ");
        const apiKey = await rl.question("  API Key: ");
        const profileAnswer = await rl.question("  Security profile [safe-local/vibe/platform] (default: safe-local): ");

        const profile = readProfile(profileAnswer.trim()) ?? "safe-local";

        const storedConfig: Record<string, unknown> = {
          provider: "openai-compatible",
          model: model.trim(),
          apiKey: apiKey.trim(),
          allowModelApiCall: true,
          profile,
        };
        if (baseUrl.trim()) {
          storedConfig.baseUrl = baseUrl.trim();
        }

        await mkdir(dirname(configPath), { recursive: true });
        await writeFile(configPath, `${JSON.stringify(storedConfig, null, 2)}\n`, "utf8");

        process.stdout.write(`\n  Configuration saved to ${configPath}\n\n`);
        process.stdout.write("  You're ready to go! Try:\n\n");
        process.stdout.write("    octopus run \"analyze this repository\"\n");
        process.stdout.write("    octopus pack list\n");
        process.stdout.write("    octopus pack run repo-health-check\n\n");
      } finally {
        rl.close();
      }
    });

  program
    .command("run")
    .argument("<goal>")
    .option("--profile <profile>", "security profile: safe-local, vibe, or platform")
    .option("--policy-file <path>", "platform policy file (implies --profile platform)")
    .action(async (description: string, options: CommandOptions) => {
      const config = applyCommandOverrides(configFactory(), options);
      assertValidConfig(config);
      const app = await resolvedDependencies.createLocalWorkEngine(config);
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

      const app = await resolvedDependencies.createLocalWorkEngine(config);
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
      const app = await resolvedDependencies.createLocalWorkEngine(configFactory());
      const sessions = await app.store.listSessions();
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    });

  program
    .command("status")
    .argument("[sessionId]")
    .action(async (sessionId?: string) => {
      const app = await resolvedDependencies.createLocalWorkEngine(configFactory());
      if (!sessionId) {
        const sessions = await app.store.listSessions();
        process.stdout.write(`${JSON.stringify(sessions.at(-1) ?? null, null, 2)}\n`);
        return;
      }

      const session = await app.store.loadSession(sessionId);
      process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    });

  program
    .command("resume")
    .argument("<sessionId>")
    .option("--answer <text>", "Provide clarification answer")
    .option("--approve", "Approve the pending action")
    .option("--reject", "Reject the pending action")
    .option("--profile <profile>", "security profile")
    .option("--policy-file <path>", "platform policy file")
    .action(async (sessionId: string, options: ResumeOptions) => {
      const config = applyCommandOverrides(configFactory(), options);
      assertValidConfig(config);

      const app = await resolvedDependencies.createLocalWorkEngine(config);

      let resumeInput: import("@octopus/agent-runtime").ResumeInput;
      if (options.answer) {
        resumeInput = { kind: "clarification", answer: options.answer };
      } else if (options.approve) {
        resumeInput = { kind: "approval", decision: "approve" };
      } else if (options.reject) {
        resumeInput = { kind: "approval", decision: "reject" };
      } else {
        resumeInput = { kind: "operator" };
      }

      const session = await app.engine.resumeBlockedSession(sessionId, resumeInput);
      await app.flushTraces();
      process.stdout.write(`${session.state}\n`);
    });

  program
    .command("checkpoints")
    .argument("<sessionId>")
    .action(async (sessionId: string) => {
      const app = await resolvedDependencies.createLocalWorkEngine(configFactory());
      const snapshots = await app.store.listSnapshots(sessionId);
      if (snapshots.length === 0) {
        process.stdout.write("No checkpoints found.\n");
        return;
      }
      for (const snap of snapshots) {
        process.stdout.write(`${snap.snapshotId}  ${snap.capturedAt.toISOString()}\n`);
      }
    });

  program
    .command("rollback")
    .argument("<sessionId>")
    .argument("[snapshotId]")
    .option("--profile <profile>", "security profile")
    .option("--policy-file <path>", "platform policy file")
    .action(async (sessionId: string, snapshotId: string | undefined, options: CommandOptions) => {
      const config = applyCommandOverrides(configFactory(), options);
      assertValidConfig(config);

      const app = await resolvedDependencies.createLocalWorkEngine(config);
      const storedSession = await app.store.loadSession(sessionId);
      if (!storedSession) {
        throw new Error(`Unknown session: ${sessionId}`);
      }

      const goal = createWorkGoal({
        id: storedSession.goalId,
        namedGoalId: storedSession.namedGoalId,
        description: storedSession.goalSummary ?? `Rollback session ${sessionId}`
      });

      const session = await app.engine.executeGoal(goal, {
        workspaceRoot: config.workspaceRoot,
        resumeFrom: { sessionId, ...(snapshotId ? { snapshotId } : {}) }
      });
      await app.flushTraces();
      process.stdout.write(`${session.state}\n`);
    });

  const evalCommand = program.command("eval");

  evalCommand
    .command("run")
    .option("--suite <path>", "Path to eval suite directory", ".octopus/evals")
    .option("--profile <profile>", "security profile: safe-local, vibe, or platform", "vibe")
    .action(async (options: { suite: string; profile?: string }) => {
      const config = configFactory();
      const evalProfile = options.profile ? parseProfileOption(options.profile) : "vibe";
      const suitePath = resolve(config.workspaceRoot, options.suite);
      const cases = await loadEvalSuite(suitePath);
      if (cases.length === 0) {
        process.stdout.write("No eval cases found.\n");
        return;
      }

      const runner = new EvalRunner({
        createApp: async ({ workspaceRoot, profile }) => {
          const appConfig = {
            ...config,
            workspaceRoot,
            profile: profile as import("@octopus/security").SecurityProfileName,
          };
          return resolvedDependencies.createLocalWorkEngine(appConfig);
        },
      });

      process.stdout.write(`Running ${cases.length} eval case(s)...\n`);
      const results = await runner.runSuite(cases, { defaultProfile: evalProfile });
      const report = buildReport(options.suite, results);
      await saveReport(config.dataDir, report);

      for (const result of results) {
        const icon = result.passed ? "PASS" : "FAIL";
        process.stdout.write(`  [${icon}] ${result.caseId}: ${result.description} (${result.durationMs}ms)\n`);
        if (result.error) {
          process.stdout.write(`         Error: ${result.error}\n`);
        }
      }
      const pct = (report.summary.passRate * 100).toFixed(0);
      process.stdout.write(`\n${report.summary.passed}/${report.summary.total} passed (${pct}%)\n`);
      process.stdout.write(`Report saved: ${report.id}\n`);
    });

  evalCommand
    .command("report")
    .argument("[run-id]")
    .action(async (runId?: string) => {
      const config = configFactory();
      const report = await loadReport(config.dataDir, runId);
      if (!report) {
        process.stdout.write("No eval reports found.\n");
        return;
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

  evalCommand
    .command("list")
    .action(async () => {
      const config = configFactory();
      const reports = await listReports(config.dataDir);
      if (reports.length === 0) {
        process.stdout.write("No eval reports found.\n");
        return;
      }
      process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    });

  const packCommand = program.command("pack");

  packCommand
    .command("list")
    .action(async () => {
      const config = configFactory();
      const builtin = loadBuiltinPacks();
      const custom = await loadCustomPacks(join(config.dataDir, "packs"));
      const all = [...builtin, ...custom];
      for (const pack of all) {
        const paramStr = pack.params.length > 0
          ? ` (${pack.params.map((p) => p.required ? p.name : `${p.name}?`).join(", ")})`
          : "";
        process.stdout.write(`  [${pack.category}] ${pack.id}${paramStr} — ${pack.description}\n`);
      }
      process.stdout.write(`\n${all.length} pack(s) available.\n`);
    });

  packCommand
    .command("info")
    .argument("<pack-id>")
    .action(async (packId: string) => {
      const config = configFactory();
      const builtin = loadBuiltinPacks();
      const custom = await loadCustomPacks(join(config.dataDir, "packs"));
      const pack = [...builtin, ...custom].find((p) => p.id === packId);
      if (!pack) {
        throw new Error(`Unknown pack: ${packId}. Run 'octopus pack list' to see available packs.`);
      }
      process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
    });

  packCommand
    .command("run")
    .argument("<pack-id>")
    .option("--param <params...>", "Parameters as key=value pairs")
    .option("--profile <profile>", "security profile: safe-local, vibe, or platform")
    .option("--policy-file <path>", "platform policy file (implies --profile platform)")
    .action(async (packId: string, options: { param?: string[]; profile?: string; policyFile?: string }) => {
      const config = applyCommandOverrides(configFactory(), {
        profile: options.profile,
        policyFile: options.policyFile
      });
      assertValidConfig(config);

      const builtin = loadBuiltinPacks();
      const custom = await loadCustomPacks(join(config.dataDir, "packs"));
      const pack = [...builtin, ...custom].find((p) => p.id === packId);
      if (!pack) {
        throw new Error(`Unknown pack: ${packId}. Run 'octopus pack list' to see available packs.`);
      }

      const params = parsePackParams(options.param ?? []);
      validateParams(pack, params);
      const goal = resolveGoal(pack, params);

      const app = await resolvedDependencies.createLocalWorkEngine(config);
      const session = await app.engine.executeGoal(goal, {
        workspaceRoot: config.workspaceRoot
      });
      await app.flushTraces();
      process.stdout.write(`${session.state}\n`);
    });

  const remoteCommand = program.command("remote");
  remoteCommand
    .command("sessions")
    .argument("<url>")
    .option("--api-key <apiKey>", "gateway API key")
    .action(async (url: string, options: RemoteCommandOptions) => {
      const config = configFactory();
      const remoteClient = resolvedDependencies.createRemoteClient({
        gatewayUrl: url,
        apiKey: resolveRemoteApiKey(config, options)
      });
      const sessions = await remoteClient.listSessions();
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    });

  remoteCommand
    .command("attach")
    .argument("<url>")
    .argument("<sessionId>")
    .option("--api-key <apiKey>", "gateway API key")
    .action(async (url: string, sessionId: string, options: RemoteCommandOptions) => {
      const config = configFactory();
      const remoteClient = resolvedDependencies.createRemoteClient({
        gatewayUrl: url,
        apiKey: resolveRemoteApiKey(config, options)
      });
      await attachRemoteSession(remoteClient, sessionId);
    });

  remoteCommand
    .command("run")
    .argument("<url>")
    .argument("<goal>")
    .option("--api-key <apiKey>", "gateway API key")
    .action(async (url: string, description: string, options: RemoteCommandOptions) => {
      const config = configFactory();
      const remoteClient = resolvedDependencies.createRemoteClient({
        gatewayUrl: url,
        apiKey: resolveRemoteApiKey(config, options)
      });
      const { sessionId } = await remoteClient.submitGoal(description);
      await attachRemoteSession(remoteClient, sessionId);
    });

  const gatewayCommand = program.command("gateway");
  gatewayCommand
    .command("run")
    .option("--profile <profile>", "security profile: vibe or platform")
    .option("--policy-file <path>", "platform policy file (implies --profile platform)")
    .action(async (options: CommandOptions) => {
      const config = applyCommandOverrides(configFactory(), options);
      assertGatewayProfile(config.profile ?? "safe-local");
      assertGatewayConfig(config);

      const app = await resolvedDependencies.createGatewayApp({
        ...config,
        gateway: config.gateway!
      });

      await app.gatewayServer.start();
      process.stdout.write(`gateway listening on ${config.gateway!.host}:${config.gateway!.port}\n`);

      try {
        await resolvedDependencies.waitForGatewayStop();
      } finally {
        await app.gatewayServer.stop();
        await app.flushTraces();
      }
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

      const app = await resolvedDependencies.createLocalWorkEngine(config);
      const automationConfig = resolvedDependencies.loadAutomationConfig(join(config.dataDir, "automation.json"));
      const dispatcher = new AutomationDispatcher(
        app.store,
        app.engine,
        automationConfig.goals,
        app.eventBus,
        { workspaceRoot: config.workspaceRoot }
      );
      const sources = automationConfig.sources.map((source) => createAutomationSource(source, resolvedDependencies));
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

        await resolvedDependencies.waitForAutomationStop();
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

  const mcpCommand = program.command("mcp");
  mcpCommand
    .command("list-servers")
    .action(async () => {
      const config = configFactory();
      const servers = config.mcp?.servers ?? [];
      process.stdout.write(
        `${JSON.stringify(
          servers.map((server) => ({
            id: server.id,
            transport: server.transport,
            status: "not tested"
          })),
          null,
          2
        )}\n`
      );
    });

  mcpCommand
    .command("list-tools")
    .action(async () => {
      const config = configFactory();
      const manager = await connectConfiguredMcpServers(config, resolvedDependencies);
      if (!manager) {
        process.stdout.write("[]\n");
        return;
      }

      try {
        process.stdout.write(`${JSON.stringify(formatMcpTools(manager.getAllTools()), null, 2)}\n`);
      } finally {
        await manager.stopAll();
      }
    });

  mcpCommand
    .command("test")
    .argument("<serverId>")
    .action(async (serverId: string) => {
      const config = configFactory();
      const server = config.mcp?.servers.find((entry) => entry.id === serverId);
      if (!server) {
        throw new Error(`Unknown MCP server: ${serverId}`);
      }

      const classifier = resolvedDependencies.createMcpSecurityClassifier();
      const manager = resolvedDependencies.createMcpServerManager(classifier);
      const eventBus = new EventBus();
      await manager.startAll([server], eventBus);

      try {
        const tools = manager.getAllTools().filter((tool) => tool.serverId === serverId);
        process.stdout.write(
          `${JSON.stringify(
            {
              serverId,
              transport: server.transport,
              status: "connected",
              toolCount: tools.length
            },
            null,
            2
          )}\n`
        );
      } finally {
        await manager.stopAll();
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

export function createDefaultConfig(workspaceRoot: string, modelClient: ModelClient): LocalAppConfig {
  const dataDir = join(workspaceRoot, ".octopus");
  const systemConfigDir = join(workspaceRoot, ".octopus", "system");
  const configPath = join(dataDir, "config.json");
  const { config: fileConfig, issues: fileConfigIssues } = readFileConfig(configPath);
  const configIssues = [...fileConfigIssues];
  const { users: envUsers, issue: envUsersIssue } = readGatewayUsers(process.env.OCTOPUS_USERS_JSON);
  const envProviderIssue = createUnsupportedProviderIssue("OCTOPUS_PROVIDER", process.env.OCTOPUS_PROVIDER);
  const trustProxyCIDRs =
    readGatewayCidrs(process.env.OCTOPUS_GATEWAY_TRUST_PROXY_CIDRS)
    ?? fileConfig.gateway?.trustProxyCIDRs;
  const enableRuntimeProxy =
    readBoolean(process.env.OCTOPUS_GATEWAY_ENABLE_RUNTIME_PROXY)
    ?? fileConfig.gateway?.enableRuntimeProxy;
  const profile = readProfile(process.env.OCTOPUS_PROFILE) ?? fileConfig.profile ?? "safe-local";
  const persistentSystemConfig = readPersistentSystemConfig(systemConfigDir);
  if (envProviderIssue) {
    configIssues.push(envProviderIssue);
  }
  if (envUsersIssue) {
    configIssues.push(envUsersIssue);
  }

  const gatewayBase = {
    port: readNumber(process.env.OCTOPUS_GATEWAY_PORT) ?? fileConfig.gateway?.port ?? 4_321,
    host: process.env.OCTOPUS_GATEWAY_HOST ?? fileConfig.gateway?.host ?? "127.0.0.1",
    systemConfigDir,
    ...(fileConfig.gateway?.tls ? { tls: fileConfig.gateway.tls } : {}),
    ...(trustProxyCIDRs ? { trustProxyCIDRs } : {}),
    ...(enableRuntimeProxy === undefined ? {} : { enableRuntimeProxy })
  };

  if (persistentSystemConfig) {
    return {
      workspaceRoot,
      dataDir,
      setupMode: false,
      runtime: {
        provider: "openai-compatible",
        model: persistentSystemConfig.runtime.model,
        apiKey: persistentSystemConfig.runtime.apiKey,
        maxTokens: persistentSystemConfig.runtime.maxTokens ?? 4_096,
        temperature: persistentSystemConfig.runtime.temperature ?? 0,
        baseUrl: persistentSystemConfig.runtime.baseUrl,
        allowModelApiCall: true
      },
      profile,
      gateway: {
        ...gatewayBase,
        apiKey: persistentSystemConfig.auth.gatewayApiKey,
        users: persistentSystemConfig.auth.users.map((user) => ({ ...user }))
      },
      ...(configIssues.length > 0 ? { configIssues } : {}),
      ...(fileConfig.mcp ? { mcp: fileConfig.mcp } : {}),
      modelClient
    };
  }

  const hasCompleteLegacyRuntime =
    typeof process.env.OCTOPUS_MODEL === "string"
    && process.env.OCTOPUS_MODEL.trim().length > 0
    && typeof process.env.OCTOPUS_API_KEY === "string"
    && process.env.OCTOPUS_API_KEY.trim().length > 0;
  const hasCompleteLegacyAuth =
    (typeof process.env.OCTOPUS_GATEWAY_API_KEY === "string"
      && process.env.OCTOPUS_GATEWAY_API_KEY.trim().length > 0)
    || Boolean(envUsers);

  if (hasCompleteLegacyRuntime && hasCompleteLegacyAuth) {
    return {
      workspaceRoot,
      dataDir,
      setupMode: false,
      runtime: {
        provider: readProvider(process.env.OCTOPUS_PROVIDER) ?? fileConfig.provider ?? "openai-compatible",
        model: process.env.OCTOPUS_MODEL ?? fileConfig.model ?? "",
        apiKey: process.env.OCTOPUS_API_KEY ?? fileConfig.apiKey ?? "",
        maxTokens: readNumber(process.env.OCTOPUS_MAX_TOKENS) ?? fileConfig.maxTokens ?? 4_096,
        temperature: readNumber(process.env.OCTOPUS_TEMPERATURE) ?? fileConfig.temperature ?? 0,
        baseUrl: process.env.OCTOPUS_BASE_URL ?? fileConfig.baseUrl,
        allowModelApiCall:
          readBoolean(process.env.OCTOPUS_ALLOW_MODEL_API_CALL) ?? fileConfig.allowModelApiCall ?? false
      },
      profile,
      gateway: {
        ...gatewayBase,
        apiKey: process.env.OCTOPUS_GATEWAY_API_KEY ?? fileConfig.gateway?.apiKey ?? "",
        ...(envUsers ? { users: envUsers } : {})
      },
      ...(configIssues.length > 0 ? { configIssues } : {}),
      ...(fileConfig.mcp ? { mcp: fileConfig.mcp } : {}),
      modelClient
    };
  }

  return {
    workspaceRoot,
    dataDir,
    runtime: {
      provider: readProvider(process.env.OCTOPUS_PROVIDER) ?? fileConfig.provider ?? "openai-compatible",
      model: "",
      apiKey: "",
      maxTokens: readNumber(process.env.OCTOPUS_MAX_TOKENS) ?? fileConfig.maxTokens ?? 4_096,
      temperature: readNumber(process.env.OCTOPUS_TEMPERATURE) ?? fileConfig.temperature ?? 0,
      baseUrl: process.env.OCTOPUS_BASE_URL ?? fileConfig.baseUrl,
      allowModelApiCall: false
    },
    setupMode: true,
    profile,
    gateway: {
      ...gatewayBase,
      apiKey: randomUUID(),
      users: [],
      ...(process.env.OCTOPUS_SETUP_TOKEN ? { setupToken: process.env.OCTOPUS_SETUP_TOKEN } : {})
    },
    ...(configIssues.length > 0 ? { configIssues } : {}),
    ...(fileConfig.mcp ? { mcp: fileConfig.mcp } : {}),
    modelClient: createSetupModeModelClient()
  };
}

function createSetupModeModelClient(): ModelClient {
  return {
    async completeTurn() {
      throw new Error("System not initialized");
    }
  };
}

function describeConfig(config: LocalAppConfig) {
  return {
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    setupMode: config.setupMode ?? false,
    runtime: {
      provider: config.runtime.provider,
      model: config.runtime.model,
      baseUrl: config.runtime.baseUrl ?? null,
      maxTokens: config.runtime.maxTokens,
      temperature: config.runtime.temperature,
      allowModelApiCall: config.runtime.allowModelApiCall,
      apiKeyConfigured: config.runtime.apiKey.trim().length > 0
    },
    gateway: {
      port: config.gateway?.port ?? 4_321,
      host: config.gateway?.host ?? "127.0.0.1",
      apiKeyConfigured: Boolean(config.gateway?.apiKey?.trim()),
      browserUsersConfigured: config.gateway?.users?.length ?? 0,
      trustProxyCIDRs: config.gateway?.trustProxyCIDRs ?? [],
      enableRuntimeProxy: config.gateway?.enableRuntimeProxy ?? false
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
  if (config.configIssues?.length) {
    errors.push(...config.configIssues);
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
  gateway?: StoredGatewayConfig;
  mcp?: {
    servers: import("@octopus/adapter-mcp").McpServerConfig[];
  };
}

interface PersistentSystemConfig {
  runtime: {
    provider: "openai-compatible";
    model: string;
    apiKey: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
  };
  auth: {
    gatewayApiKey: string;
    users: NonNullable<GatewayConfigSection["users"]>;
  };
  meta: {
    initialized: boolean;
    initializedAt: string;
    initializedBy: string;
    schemaVersion: number;
  };
}

interface StoredGatewayConfig {
  port?: number;
  host?: string;
  apiKey?: string;
  tls?: {
    cert: string;
    key: string;
  };
  trustProxyCIDRs?: string[];
  enableRuntimeProxy?: boolean;
}

interface CommandOptions {
  profile?: string;
  policyFile?: string;
}

interface RestoreOptions extends CommandOptions {
  at?: string;
}

interface ResumeOptions extends CommandOptions {
  answer?: string;
  approve?: boolean;
  reject?: boolean;
}

interface RemoteCommandOptions {
  apiKey?: string;
}

function readFileConfig(path: string): { config: StoredConfig; issues: string[] } {
  if (!existsSync(path)) {
    return { config: {}, issues: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const issues: string[] = [];
    const providerIssue = createUnsupportedProviderIssue("runtime.provider", parsed.provider);
    if (providerIssue) {
      issues.push(providerIssue);
    }
    return {
      config: {
        provider: readProvider(parsed.provider),
        model: readString(parsed.model),
        apiKey: readString(parsed.apiKey),
        maxTokens: typeof parsed.maxTokens === "number" ? parsed.maxTokens : undefined,
        temperature: typeof parsed.temperature === "number" ? parsed.temperature : undefined,
        baseUrl: readString(parsed.baseUrl),
        allowModelApiCall: typeof parsed.allowModelApiCall === "boolean" ? parsed.allowModelApiCall : undefined,
        profile: readProfile(parsed.profile),
        gateway: readGatewayConfig(parsed.gateway),
        mcp: readMcpConfig(parsed.mcp)
      },
      issues
    };
  } catch {
    return { config: {}, issues: [] };
  }
}

function readPersistentSystemConfig(systemConfigDir: string): PersistentSystemConfig | null {
  try {
    const meta = JSON.parse(readFileSync(join(systemConfigDir, "meta.json"), "utf8")) as PersistentSystemConfig["meta"];
    const runtime = JSON.parse(
      readFileSync(join(systemConfigDir, "runtime.json"), "utf8")
    ) as PersistentSystemConfig["runtime"];
    const auth = JSON.parse(readFileSync(join(systemConfigDir, "auth.json"), "utf8")) as PersistentSystemConfig["auth"];

    if (meta.initialized !== true) {
      return null;
    }

    return {
      runtime,
      auth,
      meta
    };
  } catch {
    return null;
  }
}

async function setConfigValue(
  configPath: string,
  key: string,
  rawValue: string
): Promise<{ key: string; storedConfig: StoredConfig; displayValue: string | number | boolean | string[] }> {
  const parsed = parseConfigKeyValue(key, rawValue);
  const { config: current } = readFileConfig(configPath);
  const next = applyStoredConfigValue(current, parsed.key, parsed.value);

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return {
    key: parsed.key,
    storedConfig: next,
    displayValue: parsed.key === "apiKey" || parsed.key === "gateway.apiKey" ? "[redacted]" : parsed.value
  };
}

function parseConfigKeyValue(
  key: string,
  rawValue: string
): { key: string; value: string | number | boolean | string[] } {
  switch (key) {
    case "apiKey":
      return { key, value: rawValue };
    case "model":
      return { key, value: requireNonEmptyString(rawValue, "model") };
    case "provider": {
      const provider = readProvider(rawValue);
      if (!provider) {
        throw new Error("provider must be: openai-compatible");
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
    case "gateway.apiKey":
      return { key, value: rawValue };
    case "gateway.host":
      return { key, value: requireNonEmptyString(rawValue, "gateway.host") };
    case "gateway.port": {
      const value = readNumber(rawValue);
      if (value === undefined || !Number.isInteger(value) || value <= 0) {
        throw new Error("gateway.port must be a positive integer");
      }
      return { key, value };
    }
    case "gateway.trustProxyCIDRs": {
      const values = rawValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      return { key, value: values };
    }
    case "gateway.enableRuntimeProxy": {
      const value = readBoolean(rawValue);
      if (value === undefined) {
        throw new Error("gateway.enableRuntimeProxy must be true or false");
      }
      return { key, value };
    }
    default:
      throw new Error(
        "Unsupported config key. Allowed keys: apiKey, model, provider, baseUrl, maxTokens, temperature, allowModelApiCall, profile, gateway.apiKey, gateway.host, gateway.port, gateway.trustProxyCIDRs, gateway.enableRuntimeProxy"
      );
  }
}

function sanitizeStoredConfig(config: StoredConfig) {
  return {
    ...config,
    apiKey: config.apiKey ? "[redacted]" : config.apiKey,
    gateway: config.gateway
      ? {
          ...config.gateway,
          apiKey: config.gateway.apiKey ? "[redacted]" : config.gateway.apiKey
        }
      : config.gateway
  };
}

function createUnsupportedProviderIssue(source: string, value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  const rawValue = typeof value === "string" ? value.trim() : String(value);
  if (rawValue.length === 0 || readProvider(rawValue)) {
    return null;
  }

  return `${source} "${rawValue}" is no longer supported. Use "openai-compatible" and update baseUrl, model, and apiKey before running the embedded runtime.`;
}

function readGatewayConfig(value: unknown): StoredGatewayConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const port = typeof raw.port === "number" ? raw.port : undefined;
  const host = readString(raw.host);
  const apiKey = readString(raw.apiKey);
  const tls = readTlsConfig(raw.tls);
  const trustProxyCIDRs = Array.isArray(raw.trustProxyCIDRs)
    ? raw.trustProxyCIDRs.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;
  const enableRuntimeProxy = typeof raw.enableRuntimeProxy === "boolean" ? raw.enableRuntimeProxy : undefined;

  return {
    ...(port === undefined ? {} : { port }),
    ...(host ? { host } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(tls ? { tls } : {}),
    ...(trustProxyCIDRs ? { trustProxyCIDRs } : {}),
    ...(enableRuntimeProxy === undefined ? {} : { enableRuntimeProxy })
  };
}

function readGatewayUsers(raw: string | undefined): {
  users?: GatewayConfigSection["users"];
  issue?: string;
} {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return {
        issue: "OCTOPUS_USERS_JSON must be a JSON array of {username,passwordHash,role}"
      };
    }

    const users = parsed.flatMap((entry) => {
      if (
        typeof entry === "object"
        && entry !== null
        && !Array.isArray(entry)
        && typeof entry.username === "string"
        && typeof entry.passwordHash === "string"
        && (entry.role === "viewer" || entry.role === "operator" || entry.role === "admin")
      ) {
        return [{
          username: entry.username,
          passwordHash: entry.passwordHash,
          role: entry.role
        }];
      }
      return [];
    });

    if (users.length !== parsed.length) {
      return {
        issue: "OCTOPUS_USERS_JSON entries must include username, passwordHash, and role"
      };
    }

    return {
      users
    };
  } catch {
    return {
      issue: "OCTOPUS_USERS_JSON must be valid JSON"
    };
  }
}

function readGatewayCidrs(raw: string | undefined): string[] | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : undefined;
}

function readTlsConfig(value: unknown): GatewayConfigSection["tls"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const cert = readString(raw.cert);
  const key = readString(raw.key);
  if (!cert || !key) {
    return undefined;
  }

  return { cert, key };
}

function applyStoredConfigValue(
  current: StoredConfig,
  key: string,
  value: string | number | boolean | string[]
): StoredConfig {
  if (!key.startsWith("gateway.")) {
    return {
      ...current,
      [key]: value
    };
  }

  const gatewayKey = key.slice("gateway.".length) as keyof StoredGatewayConfig;
  return {
    ...current,
    gateway: {
      ...(current.gateway ?? {}),
      [gatewayKey]: value
    }
  };
}

function readMcpConfig(value: unknown): StoredConfig["mcp"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.servers)) {
    return undefined;
  }

  const servers = raw.servers
    .map(readMcpServerConfig)
    .filter((entry): entry is import("@octopus/adapter-mcp").McpServerConfig => entry !== undefined);

  return {
    servers
  };
}

function readMcpServerConfig(value: unknown): import("@octopus/adapter-mcp").McpServerConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const id = readString(raw.id);
  const transport = readMcpTransport(raw.transport);
  if (!id || !transport) {
    return undefined;
  }

  return {
    id,
    transport,
    ...(readString(raw.command) ? { command: readString(raw.command)! } : {}),
    ...(Array.isArray(raw.args) ? { args: raw.args.filter((entry): entry is string => typeof entry === "string") } : {}),
    ...(readString(raw.url) ? { url: readString(raw.url)! } : {}),
    ...(readStringRecord(raw.env) ? { env: readStringRecord(raw.env)! } : {}),
    ...(readToolPolicyRecord(raw.toolPolicy) ? { toolPolicy: readToolPolicyRecord(raw.toolPolicy)! } : {}),
    ...(raw.defaultToolPolicy === "allow" || raw.defaultToolPolicy === "deny"
      ? { defaultToolPolicy: raw.defaultToolPolicy }
      : {})
  };
}

function readToolPolicyRecord(
  value: unknown
): Record<string, import("@octopus/adapter-mcp").McpToolPolicy> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, import("@octopus/adapter-mcp").McpToolPolicy> = {};
  for (const [key, rawPolicy] of Object.entries(value)) {
    const policy = readToolPolicy(rawPolicy);
    if (policy) {
      result[key] = policy;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function readToolPolicy(value: unknown): import("@octopus/adapter-mcp").McpToolPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.allowed !== "boolean") {
    return undefined;
  }

  const securityCategory =
    raw.securityCategory === "read"
    || raw.securityCategory === "patch"
    || raw.securityCategory === "shell"
    || raw.securityCategory === "network"
      ? raw.securityCategory
      : undefined;
  const riskLevel =
    raw.riskLevel === "safe"
    || raw.riskLevel === "consequential"
    || raw.riskLevel === "dangerous"
      ? raw.riskLevel
      : undefined;

  return {
    allowed: raw.allowed,
    ...(securityCategory ? { securityCategory } : {}),
    ...(riskLevel ? { riskLevel } : {})
  };
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function readMcpTransport(value: unknown): import("@octopus/adapter-mcp").McpServerConfig["transport"] | undefined {
  return value === "stdio" || value === "streamable-http" || value === "sse" ? value : undefined;
}

function resolveRemoteApiKey(config: LocalAppConfig, options: RemoteCommandOptions): string {
  const apiKey = options.apiKey ?? config.gateway?.apiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("Remote commands require --api-key or gateway.apiKey in config.");
  }

  return apiKey;
}

function assertGatewayProfile(profile: SecurityProfileName): void {
  if (profile === "safe-local") {
    throw new Error("Gateway requires 'vibe' or 'platform' profile.\nUse: octopus gateway run --profile vibe");
  }
}

function assertGatewayConfig(config: LocalAppConfig): asserts config is LocalAppConfig & { gateway: GatewayConfigSection } {
  if (!config.gateway) {
    throw new Error("Gateway configuration is required. Set gateway.port, gateway.host, and gateway.apiKey.");
  }
  if (config.gateway.apiKey.trim().length === 0) {
    throw new Error("gateway.apiKey must be configured.");
  }
}

async function attachRemoteSession(remoteClient: RemoteClientLike, sessionId: string): Promise<void> {
  const stdout = process.stdout;
  const stdin = process.stdin;
  let completionResolve!: () => void;
  const completion = new Promise<void>((resolve) => {
    completionResolve = resolve;
  });

  let activeApproval: ApprovalRequestedMessage | undefined;
  let buffer = "";
  let handle: RemoteAttachHandle | undefined;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    stdin.off("data", onInput);
    if (stdin.isTTY) {
      stdin.setRawMode?.(false);
    }
    stdin.pause();
  };

  const onEvent = (event: WorkEvent) => {
    stdout.write(`${JSON.stringify(event)}\n`);
    if (
      event.type === "session.completed"
      || event.type === "session.failed"
      || event.type === "session.cancelled"
    ) {
      handle?.detach();
      cleanup();
      completionResolve();
    }
  };

  const onClose = (reason: string) => {
    stdout.write(`disconnected: ${reason}\n`);
    cleanup();
    completionResolve();
  };

  const onApprovalRequested = (approval: ApprovalRequestedMessage) => {
    activeApproval = approval;
    stdout.write(`[APPROVAL] ${approval.description} (risk: ${approval.riskLevel}) [y/n]?\n`);
  };

  handle = await remoteClient.attachToSession(sessionId, onEvent, onClose, onApprovalRequested);

  if (stdin.isTTY) {
    stdin.setRawMode?.(true);
  }
  stdin.setEncoding("utf8");
  stdin.resume();
  stdin.on("data", onInput);

  await completion;

  async function onInput(chunk: string): Promise<void> {
    if (chunk.includes("\u0003")) {
      handle?.detach();
      cleanup();
      completionResolve();
      return;
    }

    if (chunk.includes("\u0010")) {
      await handle?.sendControl("pause");
      return;
    }

    if (chunk.includes("\u0012")) {
      await handle?.sendControl("resume");
      return;
    }

    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }

      if (activeApproval) {
        if (line === "y" || line === "yes") {
          await handle?.sendApproval(activeApproval.promptId, "approve");
          activeApproval = undefined;
        } else if (line === "n" || line === "no") {
          await handle?.sendApproval(activeApproval.promptId, "deny");
          activeApproval = undefined;
        }
        continue;
      }

      if (line === "/cancel") {
        await handle?.sendControl("cancel");
      }
    }
  }
}

function readProvider(value: unknown): LocalAppConfig["runtime"]["provider"] | undefined {
  return value === "openai-compatible" ? value : undefined;
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

function parsePackParams(rawParams: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eqIndex = raw.indexOf("=");
    if (eqIndex <= 0) {
      throw new Error(`Invalid parameter format: "${raw}". Use key=value.`);
    }
    params[raw.slice(0, eqIndex)] = raw.slice(eqIndex + 1);
  }
  return params;
}

async function connectConfiguredMcpServers(
  config: LocalAppConfig,
  dependencies: CliDependencies
): Promise<McpServerManager | undefined> {
  if (!config.mcp?.servers.length) {
    return undefined;
  }

  const classifier = dependencies.createMcpSecurityClassifier();
  const manager = dependencies.createMcpServerManager(classifier);
  await manager.startAll(config.mcp.servers, new EventBus());
  return manager;
}

function formatMcpTools(tools: McpToolDefinition[]) {
  return tools.map((tool) => ({
    serverId: tool.serverId,
    name: tool.name,
    description: tool.description ?? null
  }));
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

async function waitForGatewayStop(): Promise<void> {
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
