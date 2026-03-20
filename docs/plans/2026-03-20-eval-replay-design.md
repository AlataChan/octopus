# 路线二：评测与回放系统 — Design

**日期**：2026-03-20
**状态**：待 Review
**关联战略**：[docs/strategy/2026-03-20-next-phase-strategy.md](../strategy/2026-03-20-next-phase-strategy.md)

---

## 目标

建立评测基准，使每次变更（换模型、改 prompt、加工具）都能量化验证没有退化。

**完成后**：
- `octopus eval run --suite .octopus/evals/` 运行一组 eval case，输出通过率和评分
- `octopus eval report <run-id>` 查看历史 eval 结果
- eval case 是纯数据（JSON），不依赖运行时代码

---

## 当前状态分析

### 已有基础（不重建）

- `VerificationPlugin` 接口已标准化（[plugin.ts](../../packages/work-core/src/verification/plugin.ts)）
- `TestRunnerPlugin` 可执行任意 shell 命令并收集 pass/fail（[test-runner.ts](../../packages/work-core/src/verification/test-runner.ts)）
- `OutputComparePlugin` 做精确文件比对（[output-compare.ts](../../packages/work-core/src/verification/output-compare.ts)）
- `TraceReader` 可读取完整 session 事件流（[trace-reader.ts](../../packages/observability/src/trace-reader.ts)）
- `WorkEngine.executeGoal` + `VerificationPlugin` 已是完整的"执行→验证"链路
- CLI 已有 `replay` 命令展示 trace 事件

### 需要新建

| 缺口 | 影响 |
| --- | --- |
| 无 EvalCase 数据格式 | 无法定义"什么算正确" |
| 无 EvalRunner 编排层 | 无法批量运行 eval cases |
| 无 EvalScorer 评分协议 | 无法量化结果 |
| 无 EvalReport 持久化 | 无法对比历史结果 |
| CLI 无 eval 命令 | 用户无法使用 |

---

## 设计决策

### 决策一：新包 `@octopus/eval-runner`，不修改 work-core

**选项 A**：在 work-core 内新增 eval 模块
**选项 B**：独立包 `@octopus/eval-runner`（**采用**）

理由：
- eval 是离线基准测试，不是运行时验证，关注点不同
- 独立包可依赖 work-core 但反向不依赖，保持层级清晰
- EvalScorer 可复用 VerificationPlugin 实现，但不绑死接口

### 决策二：EvalCase 是纯 JSON 数据，不含可执行代码

```ts
export interface EvalCase {
  id: string;
  description: string;
  goal: {
    description: string;
    namedGoalId?: string;
    constraints?: string[];
    successCriteria?: string[];
  };
  fixture?: WorkspaceFixture;       // 可选：workspace 初始文件
  assertions: EvalAssertion[];      // 必须：验证条件
  profile?: SecurityProfileName;    // 可选：安全 profile，默认 vibe
}

export interface WorkspaceFixture {
  files: Record<string, string>;    // 相对路径 → 文件内容
}

export type EvalAssertion =
  | { type: "file-exists"; path: string }
  | { type: "file-contains"; path: string; pattern: string }
  | { type: "file-matches"; path: string; expected: string }      // 精确匹配
  | { type: "shell-passes"; command: string; args?: string[] }    // exit 0
  | { type: "session-completed" }                                  // state === "completed"
  | { type: "no-blocked" }                                         // 没有 blocked 过
  | { type: "artifact-count"; min: number };                       // artifact 数量 ≥ min
```

理由：
- JSON 格式可用任何编辑器创建，无需写 TypeScript
- fixture 文件内联在 JSON 中（简单场景）或引用外部目录（复杂场景）
- assertion 类型是封闭枚举，每种都有确定性评判逻辑，不引入 LLM-as-judge

### 决策三：EvalRunner 复用 WorkEngine，不做 mock 执行

```
EvalRunner 流程：
  1. 创建临时 workspace（mkdtemp）
  2. 写入 fixture files
  3. 创建 LocalApp（engine + runtime + store）
  4. engine.executeGoal(evalCase.goal, {workspaceRoot: tempDir})
  5. 收集 session 结果 + 运行 assertions
  6. 记录 EvalResult
  7. 清理临时目录
```

理由：
- 复用真实 engine 确保 eval 结果与生产行为一致
- 不 mock model API — eval 本身就是验证真实 model 行为
- 临时 workspace 隔离，不污染用户项目

### 决策四：EvalReport 存储在 dataDir/evals/，JSON 格式

```ts
export interface EvalResult {
  caseId: string;
  passed: boolean;
  assertions: AssertionResult[];  // 每个 assertion 的 pass/fail + detail
  sessionId: string;              // 可追溯到完整 trace
  durationMs: number;
}

export interface EvalReport {
  id: string;                     // run-{timestamp}
  suite: string;                  // suite 路径
  startedAt: Date;
  completedAt: Date;
  results: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;             // 0-1
  };
}
```

存储路径：`{dataDir}/evals/{reportId}.json`

### 决策五：CLI 命令设计

```bash
# 运行 eval suite
octopus eval run --suite .octopus/evals/ [--profile vibe] [--filter <pattern>]

# 查看最近的 eval 报告
octopus eval report [run-id]

# 列出历史 eval 运行
octopus eval list
```

`eval run` 是阻塞的——逐个运行 case，实时输出进度，最后汇总。

---

## 架构变更总览

```
packages/eval-runner/           ← 新包
  src/types.ts                  EvalCase, EvalAssertion, EvalResult, EvalReport
  src/runner.ts                 EvalRunner: 编排 case 执行
  src/scorer.ts                 evaluateAssertions: 评估 assertion 结果
  src/loader.ts                 loadEvalSuite: 从目录加载 eval cases
  src/reporter.ts               saveReport / loadReport / listReports
  src/index.ts                  导出

packages/surfaces-cli/
  src/cli.ts                    新增 eval run / eval report / eval list 命令
```

依赖关系：
```
eval-runner → work-core, work-contracts, state-store, observability, security
surfaces-cli → eval-runner (新依赖)
```

---

## 数据流

### Eval Run 流

```
[CLI] octopus eval run --suite ./evals/
  → loader.loadEvalSuite("./evals/")
  → 返回 EvalCase[]

[Runner] 对每个 case:
  → mkdtemp 创建临时 workspace
  → 写入 fixture.files
  → createLocalWorkEngine({workspaceRoot: tempDir, profile: case.profile})
  → engine.executeGoal(case.goal, {workspaceRoot: tempDir, maxIterations: 20})
  → scorer.evaluateAssertions(case.assertions, {workspaceRoot: tempDir, session})
  → 收集 EvalResult
  → rm -rf tempDir

[Reporter]
  → 汇总所有 results 为 EvalReport
  → 保存到 {dataDir}/evals/{reportId}.json
  → 输出摘要到 stdout
```

### Eval Report 查看流

```
[CLI] octopus eval report [run-id]
  → reporter.loadReport(runId) 或 reporter.loadLatestReport()
  → 格式化输出到 stdout
```

---

## 边界条件

| 场景 | 处理方式 |
| --- | --- |
| eval case 的 goal 导致 blocked | session 以 blocked 结束，session-completed assertion 失败 |
| model API 不可用 | engine 返回 failed session，报告中标记为 error |
| fixture 文件路径有 `..` 穿越 | loader 拒绝，抛出 "Invalid fixture path" |
| eval case JSON 格式错误 | loader 跳过并记录 warning |
| suite 目录为空 | 报告 0 cases，退出码 0 |
| eval 运行超时 | maxIterations 限制 + case.timeout → engine 自然 blocked |
| 并发运行多个 eval | 每个 case 独立 tempDir，不冲突 |

---

## 不在范围内

- LLM-as-judge 评分：只做断言评分，LLM 评判作为后续插件
- Eval Web Dashboard：headless CLI 优先
- Eval diff（两个 report 对比）：后续功能
- Fixture 从 git repo 克隆：初版只支持内联文件
- Replay from trace（从历史 trace 重放不调 model）：已有 `replay` 命令展示 trace，真正的 replay execution 超出初版范围
