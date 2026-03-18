import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { VerificationResult } from "@octopus/work-contracts";

import type { VerificationContext, VerificationPlugin } from "./plugin.js";

export interface CommandRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type CommandRunner = (input: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => Promise<CommandRunnerResult>;

export interface TestRunnerPluginOptions {
  executable: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
}

export class TestRunnerPlugin implements VerificationPlugin {
  readonly method = "test-runner" as const;
  private readonly runner: CommandRunner;

  constructor(private readonly options: TestRunnerPluginOptions) {
    this.runner = options.runner ?? defaultRunner;
  }

  async run(context: VerificationContext): Promise<VerificationResult> {
    const result = await this.runner({
      executable: this.options.executable,
      args: this.options.args,
      cwd: context.workspaceRoot,
      env: createVerificationEnv(this.options.env)
    });

    const detail = result.stdout.trim() || result.stderr.trim() || `exitCode=${result.exitCode}`;
    return {
      id: randomUUID(),
      method: this.method,
      status: result.exitCode === 0 ? "pass" : "fail",
      evidence: [{ label: "command", value: detail, passed: result.exitCode === 0 }],
      durationMs: result.durationMs,
      createdAt: new Date()
    };
  }
}

const DEFAULT_ENV_KEYS = [
  "PATH",
  "HOME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  "COLORTERM",
  "PNPM_HOME",
  "npm_execpath",
  "npm_node_execpath",
  "npm_config_user_agent"
] as const;

export function createVerificationEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of DEFAULT_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

const defaultRunner: CommandRunner = async ({ executable, args, cwd, env }) => {
  const startedAt = Date.now();
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    durationMs: Date.now() - startedAt
  };
};
