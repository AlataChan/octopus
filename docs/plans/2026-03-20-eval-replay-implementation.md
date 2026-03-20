# 路线二：评测与回放系统 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立 headless eval runner，支持从 JSON 定义的 eval suite 批量运行评测并生成报告

**Architecture:** 新包 `@octopus/eval-runner` 提供 EvalCase 加载、Runner 编排、Assertion 评估、Report 持久化；CLI 新增 `eval run / report / list` 命令

**Tech Stack:** TypeScript, Node.js, vitest

---

## 文件变更地图

| 文件 | 操作 | 职责 |
| --- | --- | --- |
| `packages/eval-runner/package.json` | 新建 | 包配置 |
| `packages/eval-runner/tsconfig.json` | 新建 | TypeScript 配置 |
| `packages/eval-runner/src/types.ts` | 新建 | EvalCase, EvalAssertion, EvalResult, EvalReport |
| `packages/eval-runner/src/loader.ts` | 新建 | loadEvalSuite: 从目录加载 eval cases |
| `packages/eval-runner/src/scorer.ts` | 新建 | evaluateAssertions: 评估 assertion 结果 |
| `packages/eval-runner/src/runner.ts` | 新建 | EvalRunner: 编排 case 执行 |
| `packages/eval-runner/src/reporter.ts` | 新建 | saveReport / loadReport / listReports |
| `packages/eval-runner/src/index.ts` | 新建 | 导出 |
| `packages/surfaces-cli/src/cli.ts` | 修改 | 新增 eval run / report / list 命令 |
| `packages/surfaces-cli/package.json` | 修改 | 添加 @octopus/eval-runner 依赖 |
| `pnpm-workspace.yaml` | 可能修改 | 确保 eval-runner 在 workspace 中 |
| `vitest.config.ts` | 修改 | 添加 eval-runner 项目 |

**测试文件：**

| 文件 | 操作 |
| --- | --- |
| `packages/eval-runner/src/__tests__/loader.test.ts` | 新建 |
| `packages/eval-runner/src/__tests__/scorer.test.ts` | 新建 |
| `packages/eval-runner/src/__tests__/runner.test.ts` | 新建 |
| `packages/eval-runner/src/__tests__/reporter.test.ts` | 新建 |

---

## Task 1: 包脚手架 + 类型定义

**Files:**
- Create: `packages/eval-runner/package.json`
- Create: `packages/eval-runner/tsconfig.json`
- Create: `packages/eval-runner/src/types.ts`
- Create: `packages/eval-runner/src/index.ts`

- [ ] **Step 1: 创建 package.json**

参考 `packages/work-core/package.json` 的结构，创建：

```json
{
  "name": "@octopus/eval-runner",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "type-check": "tsc --noEmit",
    "test": "pnpm --dir ../../ exec vitest run --config vitest.config.ts --project eval-runner"
  },
  "dependencies": {
    "@octopus/work-contracts": "workspace:*",
    "@octopus/work-core": "workspace:*",
    "@octopus/observability": "workspace:*",
    "@octopus/state-store": "workspace:*",
    "@octopus/security": "workspace:*",
    "@octopus/agent-runtime": "workspace:*",
    "@octopus/exec-substrate": "workspace:*",
    "@octopus/runtime-embedded": "workspace:*"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 定义类型**

```ts
// packages/eval-runner/src/types.ts
import type { SecurityProfileName } from "@octopus/security";

export interface WorkspaceFixture {
  files: Record<string, string>;
}

export type EvalAssertion =
  | { type: "file-exists"; path: string }
  | { type: "file-contains"; path: string; pattern: string }
  | { type: "file-matches"; path: string; expected: string }
  | { type: "shell-passes"; command: string; args?: string[] }
  | { type: "session-completed" }
  | { type: "no-blocked" }
  | { type: "artifact-count"; min: number };

export interface EvalCase {
  id: string;
  description: string;
  goal: {
    description: string;
    namedGoalId?: string;
    constraints?: string[];
    successCriteria?: string[];
  };
  fixture?: WorkspaceFixture;
  assertions: EvalAssertion[];
  timeout?: number;
  profile?: SecurityProfileName;
}

export interface AssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  detail: string;
}

export interface EvalResult {
  caseId: string;
  description: string;
  passed: boolean;
  assertions: AssertionResult[];
  sessionId: string;
  durationMs: number;
  error?: string;
}

export interface EvalReport {
  id: string;
  suite: string;
  startedAt: string;
  completedAt: string;
  results: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  };
}
```

- [ ] **Step 4: 创建 index.ts**

```ts
export * from "./types.js";
export * from "./loader.js";
export * from "./scorer.js";
export * from "./runner.js";
export * from "./reporter.js";
```

- [ ] **Step 5: 添加到 vitest.config.ts**

在根目录 `vitest.config.ts` 的 projects 数组中添加 `eval-runner` 项目配置。

- [ ] **Step 6: pnpm install**

```bash
pnpm install
```

- [ ] **Step 7: 验证 type-check**

```bash
pnpm --filter @octopus/eval-runner run type-check
```

---

## Task 2: EvalSuite Loader

**Files:**
- Create: `packages/eval-runner/src/loader.ts`
- Create: `packages/eval-runner/src/__tests__/loader.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("loadEvalSuite", () => {
  it("loads all .json files from a directory as eval cases", async () => {
    // 创建 tmpdir，写入两个 eval case JSON
    // 调用 loadEvalSuite(dir)
    // 验证返回 2 个 EvalCase
  });

  it("rejects fixture paths with .. traversal", async () => {
    // case with fixture.files["../etc/passwd"] = "evil"
    // 验证抛出 "Invalid fixture path"
  });

  it("skips non-json files", async () => {
    // 目录中有 .md 文件
    // 验证只返回 .json 文件
  });

  it("returns empty array for empty directory", async () => {
    // 空目录
    // 验证返回 []
  });
});
```

- [ ] **Step 2: 实现 loader**

```ts
export async function loadEvalSuite(suiteDir: string): Promise<EvalCase[]>
```

- 读取目录中所有 `.json` 文件
- JSON.parse 每个文件为 EvalCase
- 验证 fixture paths 不含 `..`
- 跳过解析失败的文件（console.warn）

- [ ] **Step 3: 验证**

```bash
pnpm --filter @octopus/eval-runner test
```

---

## Task 3: Assertion Scorer

**Files:**
- Create: `packages/eval-runner/src/scorer.ts`
- Create: `packages/eval-runner/src/__tests__/scorer.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("evaluateAssertions", () => {
  it("file-exists passes when file exists", async () => {});
  it("file-exists fails when file missing", async () => {});
  it("file-contains passes when pattern found", async () => {});
  it("file-matches passes on exact match", async () => {});
  it("shell-passes passes on exit 0", async () => {});
  it("shell-passes fails on non-zero exit", async () => {});
  it("session-completed passes when state is completed", async () => {});
  it("session-completed fails when state is blocked", async () => {});
  it("no-blocked passes when no blocked transitions", async () => {});
  it("artifact-count passes when enough artifacts", async () => {});
});
```

- [ ] **Step 2: 实现 scorer**

```ts
export async function evaluateAssertions(
  assertions: EvalAssertion[],
  context: { workspaceRoot: string; session: WorkSession }
): Promise<AssertionResult[]>
```

每种 assertion type 有对应的评估逻辑：
- `file-exists`: `fs.existsSync(join(workspaceRoot, path))`
- `file-contains`: `readFile` + `content.includes(pattern)` 或 `new RegExp(pattern).test(content)`
- `file-matches`: `readFile` + `content.trim() === expected.trim()`
- `shell-passes`: `child_process.execFile` in workspaceRoot
- `session-completed`: `session.state === "completed"`
- `no-blocked`: `!session.transitions.some(t => t.to === "blocked")`
- `artifact-count`: `session.artifacts.length >= min`

- [ ] **Step 3: 验证**

```bash
pnpm --filter @octopus/eval-runner test
```

---

## Task 4: EvalRunner 编排层

**Files:**
- Create: `packages/eval-runner/src/runner.ts`
- Create: `packages/eval-runner/src/__tests__/runner.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("EvalRunner", () => {
  it("runs a passing eval case end-to-end", async () => {
    // mock engine 返回 completed session
    // 验证 EvalResult.passed === true
  });

  it("runs a failing eval case", async () => {
    // mock engine 返回 blocked session
    // 验证 EvalResult.passed === false
    // 验证 assertions 中有 session-completed 失败
  });

  it("writes fixture files to temp workspace", async () => {
    // 验证 fixture.files 被写入 tempDir
  });

  it("cleans up temp directory after run", async () => {
    // 验证 tempDir 被删除
  });

  it("handles engine errors gracefully", async () => {
    // mock engine.executeGoal throws
    // 验证 EvalResult.error 被设置，不崩溃
  });
});
```

- [ ] **Step 2: 实现 runner**

```ts
export interface EvalRunnerDeps {
  createApp: (config: { workspaceRoot: string; profile: SecurityProfileName }) => Promise<{
    engine: WorkEngine;
    store: StateStore;
    flushTraces: () => Promise<void>;
  }>;
}

export class EvalRunner {
  constructor(private readonly deps: EvalRunnerDeps) {}

  async runCase(evalCase: EvalCase): Promise<EvalResult> {
    const start = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), "octopus-eval-"));

    try {
      // 1. Write fixtures
      if (evalCase.fixture) {
        await writeFixtureFiles(tempDir, evalCase.fixture);
      }

      // 2. Create app and run goal
      const app = await this.deps.createApp({
        workspaceRoot: tempDir,
        profile: evalCase.profile ?? "vibe",
      });

      const goal = createWorkGoal({
        description: evalCase.goal.description,
        namedGoalId: evalCase.goal.namedGoalId,
        constraints: evalCase.goal.constraints ?? [],
        successCriteria: evalCase.goal.successCriteria ?? [],
      });

      const session = await app.engine.executeGoal(goal, {
        workspaceRoot: tempDir,
        maxIterations: 20,
      });

      await app.flushTraces();

      // 3. Evaluate assertions
      const assertions = await evaluateAssertions(evalCase.assertions, {
        workspaceRoot: tempDir,
        session,
      });

      return {
        caseId: evalCase.id,
        description: evalCase.description,
        passed: assertions.every((a) => a.passed),
        assertions,
        sessionId: session.id,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        caseId: evalCase.id,
        description: evalCase.description,
        passed: false,
        assertions: [],
        sessionId: "",
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async runSuite(cases: EvalCase[]): Promise<EvalResult[]> {
    const results: EvalResult[] = [];
    for (const evalCase of cases) {
      results.push(await this.runCase(evalCase));
    }
    return results;
  }
}
```

- [ ] **Step 3: 验证**

```bash
pnpm --filter @octopus/eval-runner test
```

---

## Task 5: Reporter（报告持久化）

**Files:**
- Create: `packages/eval-runner/src/reporter.ts`
- Create: `packages/eval-runner/src/__tests__/reporter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("EvalReporter", () => {
  it("saves and loads a report", async () => {});
  it("lists all reports sorted by date", async () => {});
  it("loads the latest report when no id specified", async () => {});
  it("creates the evals directory if missing", async () => {});
});
```

- [ ] **Step 2: 实现 reporter**

```ts
export async function saveReport(dataDir: string, report: EvalReport): Promise<void>
export async function loadReport(dataDir: string, reportId?: string): Promise<EvalReport | null>
export async function listReports(dataDir: string): Promise<Array<{ id: string; suite: string; passRate: number; completedAt: string }>>
```

存储路径：`{dataDir}/evals/{reportId}.json`

- [ ] **Step 3: 验证**

```bash
pnpm --filter @octopus/eval-runner test
```

---

## Task 6: CLI eval 命令

**Files:**
- Modify: `packages/surfaces-cli/src/cli.ts`
- Modify: `packages/surfaces-cli/package.json`
- Modify: `packages/surfaces-cli/src/__tests__/cli.test.ts`

- [ ] **Step 1: 添加依赖**

`packages/surfaces-cli/package.json` 中添加：
```json
"@octopus/eval-runner": "workspace:*"
```

- [ ] **Step 2: 写失败测试**

```ts
describe("eval commands", () => {
  it("eval run loads suite and outputs summary", async () => {});
  it("eval list shows report history", async () => {});
  it("eval report shows latest report", async () => {});
});
```

- [ ] **Step 3: 实现 eval 命令**

在 `buildCli` 中添加：

```ts
const evalCommand = program.command("eval");

evalCommand
  .command("run")
  .option("--suite <path>", "Path to eval suite directory", ".octopus/evals")
  .option("--profile <profile>", "security profile")
  .action(async (options) => {
    const config = configFactory();
    const cases = await loadEvalSuite(resolve(config.workspaceRoot, options.suite));
    if (cases.length === 0) {
      process.stdout.write("No eval cases found.\n");
      return;
    }

    const runner = new EvalRunner({
      createApp: async ({ workspaceRoot, profile }) =>
        resolvedDependencies.createLocalWorkEngine({ ...config, workspaceRoot, profile }),
    });

    process.stdout.write(`Running ${cases.length} eval case(s)...\n`);
    const results = await runner.runSuite(cases);
    const report = buildReport(options.suite, results);
    await saveReport(config.dataDir, report);

    for (const result of results) {
      const icon = result.passed ? "✓" : "✗";
      process.stdout.write(`  ${icon} ${result.caseId}: ${result.description} (${result.durationMs}ms)\n`);
    }
    process.stdout.write(`\n${report.summary.passed}/${report.summary.total} passed (${(report.summary.passRate * 100).toFixed(0)}%)\n`);
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
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  });

evalCommand
  .command("list")
  .action(async () => {
    const config = configFactory();
    const reports = await listReports(config.dataDir);
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  });
```

- [ ] **Step 4: 验证**

```bash
pnpm --filter @octopus/surfaces-cli test
pnpm --filter @octopus/surfaces-cli run type-check
```

---

## Task 7: 全局验证

- [ ] **Step 1: 全量类型检查**

```bash
pnpm --filter @octopus/eval-runner run type-check
pnpm --filter @octopus/surfaces-cli run type-check
```

- [ ] **Step 2: 全量测试**

```bash
pnpm test
```

Expected: All tests pass

---

## 验证命令（完成标准）

```bash
# 新包
pnpm --filter @octopus/eval-runner test
pnpm --filter @octopus/eval-runner run type-check

# CLI
pnpm --filter @octopus/surfaces-cli test

# 全量
pnpm test
```

所有命令 exit 0，无测试失败，无类型错误。
