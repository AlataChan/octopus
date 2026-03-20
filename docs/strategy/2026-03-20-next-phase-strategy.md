# Octopus 下一阶段战略方向

**日期**：2026-03-20
**状态**：已确认，待路线一设计
**作者**：Claude（架构师），Codex（评审 ×2）

---

## 当前阶段完成了什么

| 层级 | 完成状态 |
| --- | --- |
| Work Core：目标摄取 → 工作循环 → artifact 模型 | ✅ |
| 安全层：safe-local / vibe / platform 三档策略 | ✅ |
| 自动化：cron 调度、文件监听、事件注入 | ✅ |
| Gateway：HTTP/WS 双向服务、auth、事件流 | ✅ |
| MCP adapter：生态兼容层 | ✅ |
| 三个 Surface：CLI / Web UI / Chat webhook | ✅ |
| Web 任务流：TaskComposer、SessionDetail、artifact 预览 | ✅ |

**已知的结构性缺口**（Codex review 确认）：

- `resumeSession()` 是空实现（[runtime.ts:74](../../packages/runtime-embedded/src/runtime.ts)）
- gateway 的 resume 路径只改了 session 状态字段，没有重新进入 engine 工作循环（[control.ts:33](../../packages/gateway/src/routes/control.ts)）
- `blocked` 载荷（clarification question、approval action 等）没有持久化，恢复后无法重建上下文
- `blocked` 状态下的子类型（需要澄清 / 等待审批 / 验证失败 / 算子暂停）没有区分

---

## 下一阶段要证明什么

MVP 证明了"Agent 能够完成目标"。下一阶段要证明：

> **Agent 卡住之后，人可以介入并让它继续。同时系统可以在真实场景中被信任使用。**

三条候选路线各自针对这个命题的不同侧面。

---

## 三条候选路线

### 路线一：人机协作恢复闭环（Human-Agent Resume Loop）

**解决什么**：Agent 卡住后系统没有出路。`blocked` 是死胡同，gateway resume 只改了状态字段，实际工作循环没有重启。

**核心交付物**：

1. **结构化 blocked 子类型**

   不新增顶层 session 状态，而是在 `blocked` 内区分子类型：

   ```ts
   type BlockedReason =
     | { kind: 'clarification-required'; question: string }
     | { kind: 'approval-required'; action: Action; riskLevel: RiskLevel }
     | { kind: 'verification-failed'; evidence: string }
     | { kind: 'paused-by-operator' }
   ```

   子类型随 session 持久化，恢复时可重建上下文。contract 改动最小，与现有 engine/UI 语义完全一致。

2. **Engine 主导的 blocked-session continuation flow**

   这是路线一的核心，不是单点修补 `runtime.resumeSession()`。完整闭环包括三层：
   - **engine 层**：`runLoop` 能从 blocked 状态携带注入的答案/决定重新进入循环
   - **持久化层**：blocked 载荷（clarification question、审批 action）写入 snapshot，恢复时可还原
   - **gateway 层**：control 路径改为调用 engine 级恢复流，而不只是改状态字段

3. **Risk Gate**

   高风险 action 执行前自动暂停，触发 `approval-required` blocked 子类型，Web UI 展示确认对话框，CLI 打印提示等待输入。风险分级由 security profile 定义，Work Pack 只能加严，不能放宽。

4. **WS 新增消息类型**

   Gateway WS 通道已经是双向的（支持 `control` 和 `approval` 消息）。增量工作是在现有双向通道上新增 `clarification-answer` 消息类型，不需要重做传输层。

**为什么优先**：修的是已知的结构性空洞，不是新功能。完成后用户才敢把 Agent 用在有风险的真实任务上。

---

### 路线二：评测与回放系统（Eval & Replay）

**解决什么**：无法知道 Agent 变好了还是变差了。换模型、改 prompt、加工具之后没有基准。

**核心交付物**：

1. **Eval 数据集格式**

   独立定义 `EvalCase` / `EvalRunner` / `EvalScorer`，不并入 `VerificationPlugin`：

   ```ts
   // packages/eval-runner（新包）
   interface EvalCase {
     id: string;
     goal: WorkGoal;
     fixture: WorkspaceFixture;     // 测试用 workspace 初始状态
     assertions: EvalAssertion[];   // artifact diff、shell 断言等
   }
   interface EvalRunner { run(suite: EvalCase[]): Promise<EvalReport> }
   interface EvalScorer { score(actual: Artifact, expected: EvalAssertion): number }
   ```

   与 `VerificationPlugin` 保持独立——运行时完成门槛和离线 benchmark 是不同关注点，不绑死。现有 VerificationPlugin 可按需被 EvalScorer 复用，不反向依赖。

2. **Headless Eval Runner（第一版）**

   只做 CLI 可用的 headless runner，不绑定 web dashboard：

   ```bash
   octopus eval run --suite .octopus/evals/
   octopus eval replay <session-id>   # 用历史 trace 重放，对比结果
   ```

   eval dashboard（web 对比视图）作为后续子任务，不阻塞第一版交付。

3. **Scoring 支持**

   初版只做基于断言的评分（artifact diff、shell 输出断言）。LLM-as-judge 作为可选插件，不纳入初版范围。

**为什么重要**：每次扩展能力（路线三的 substrate tools）都需要基准来验证没有退化。这是可持续演进的基础设施。

---

### 路线三：场景化 Work Packs（Scenario Work Packs）

**解决什么**：用户不知道 Agent 能做什么，也不知道怎么写 goal 才有效。

**核心交付物**：

1. **Work Pack 格式**

   一个 Work Pack = goal 模板 + verification preset + automation preset + artifact bundle schema：

   ```ts
   interface WorkPack {
     id: string;
     name: string;
     category: 'dev' | 'data' | 'ops' | 'report';
     goalTemplate: string;          // 带 {{param}} 占位符
     params: ParamSchema[];
     verificationPreset: VerificationMethod[];
     automationPreset?: CronSchedule;
     expectedArtifacts: ArtifactSchema[];
   }
   ```

2. **内置 Pack 库（初版 4 个）**
   - `repo-health-check`：Git 仓库质量分析
   - `weekly-report`：按日期范围生成工作周报
   - `data-clean`：CSV 清洗 + 统计报告
   - `dep-audit`：依赖安全审计

3. **Substrate Capability Enablers（场景驱动，按需补充）**

   Work Pack 驱动工具需求，而不是反过来：
   - `http-fetch`：dep-audit 需要调用 npm registry API
   - `sql-query`：data-clean 的高级模式需要
   - `browser`：按场景需求决定，不提前实现

4. **Rich Artifact Renderer**

   按 artifact 类型路由渲染（`.md` → marked、`.csv` → 表格、`.diff` → diff viewer）。这是 Work Pack 体验的组成部分，不单独作为主方向。

**为什么第三**：依赖路线一（Agent 能真正恢复执行），也受益于路线二（Pack 的 eval 套件）。先做前两条，这条才能发挥最大价值。

---

## 确认排序

```text
Sprint 1 → 路线一：人机协作恢复闭环
           修复已知结构性空洞，建立用户信任

Sprint 2 → 路线二：评测与回放系统（headless runner 优先）
           建立演进基准，为路线三的能力扩展提供安全网

Sprint 3 → 路线三：场景化 Work Packs
           场景驱动工具扩展，降低使用门槛，推动增长
```

---

## 现在不做什么

| 项目 | 原因 |
| --- | --- |
| 先实现 substrate-tools 全套（http-fetch / browser / sql-query） | 工具先于场景，容易造成无人用的能力；应由 Work Pack 按需拉动 |
| Token Budget 作为独立方向 | 是路线一 Risk Gate 的子功能，内嵌实现即可 |
| 社区模板分享机制 | 超出 MVP 范围，等路线三内部验证后再考虑 |
| `pending-approval` 作为新顶层 session 状态 | blocked 子类型方案更优，改动更小 |
| Eval Web Dashboard（路线二首批） | headless runner 优先，dashboard 作为后续子任务 |
| LLM-as-judge 评分（路线二初版） | 断言评分已够用，LLM-as-judge 作为可选插件后续加 |

---

## 已确认决策

| # | 问题 | 结论 |
| --- | --- | --- |
| 1 | 路线排序 | 路线一 → 路线二 → 路线三 |
| 2 | Risk Gate 阈值来源 | security profile 定义；Work Pack 只能加严，不能放宽 |
| 3 | 路线二初版范围 | headless CLI runner + 断言评分；不含 web dashboard 和 LLM-as-judge |
| 4 | substrate tools 立项方式 | 由具体 Work Pack 需求触发，不作为 Sprint 3 总包立项 |

---

## 参考

- 当前架构概述：[WORK_AGENT_ARCHITECTURE.md](../WORK_AGENT_ARCHITECTURE.md)
- 最新 Web 设计：[plans/2026-03-20-task-centered-web-closure-design.md](../plans/2026-03-20-task-centered-web-closure-design.md)
- 原始方向草案（已被本文替代）：[plans/2026-03-20-next-phase-directions.md](../plans/2026-03-20-next-phase-directions.md)
