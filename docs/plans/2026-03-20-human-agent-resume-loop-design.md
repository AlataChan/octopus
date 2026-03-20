# 路线一：人机协作恢复闭环 — Design

**日期**：2026-03-20
**状态**：Review 通过（Codex 2026-03-20），待实现
**关联战略**：[docs/strategy/2026-03-20-next-phase-strategy.md](../strategy/2026-03-20-next-phase-strategy.md)

---

## 目标

修复 `blocked` 状态是死胡同的问题。当前系统：
- `resumeSession()` 是空实现（[runtime.ts:74](../../packages/runtime-embedded/src/runtime.ts)）
- gateway `resume` 只改状态字段，不重入 engine 工作循环（[control.ts:33](../../packages/gateway/src/routes/control.ts)）
- `blocked` 载荷没有持久化，恢复后丢失上下文
- `blocked` 的原因没有子类型区分，UI 和 CLI 无法差异化响应

**完成后**：用户可以在 Web UI 或 CLI 中看到 blocked 的具体原因，回答澄清问题、批准/拒绝高风险操作，session 随即从断点恢复继续执行。

---

## 当前状态分析

### 已有的基础（不需要重建）

- `SessionSnapshot` 已经持久化 session + runtimeContext（[agent-runtime/types.ts:8](../../packages/agent-runtime/src/types.ts)）
- `blockSession()` 已调用 `captureSnapshot()`（[engine.ts:302](../../packages/work-core/src/engine.ts)）
- `restoreSession()` 已实现完整的 snapshot hydration（[engine.ts:122](../../packages/work-core/src/engine.ts)）
- WS 通道已经是双向的，支持 `control` 和 `approval` 消息（[event-stream.ts:108](../../packages/gateway/src/ws/event-stream.ts)）
- `PolicyDecision.requiresConfirmation` 已存在（[policy.ts:13](../../packages/security/src/policy.ts)）
- `SessionBlockedPayload` 已有 `clarification`、`reason`、`riskLevel` 字段（[observability/types.ts:144](../../packages/observability/src/types.ts)）

### 需要修复的缺口

| 缺口 | 位置 | 影响 |
| --- | --- | --- |
| `resumeSession()` 是空实现 | `runtime-embedded/src/runtime.ts:74` | resume 后 session 内存状态不恢复 |
| gateway resume 不重入 engine | `gateway/src/routes/control.ts:33` | 改了状态字段但 agent 不会继续运行 |
| blocked 载荷不持久化 | `state-store`：session.json 无 blockedReason 字段 | 重新连接后 UI 不知道为何 blocked |
| blocked 无子类型 | `work-contracts/src/types.ts` | UI 无法渲染差异化交互（问题 vs 审批） |
| Risk Gate 只 block，不等待 | `engine.ts:198` | `requiresConfirmation` action 被直接拦截，无恢复路径 |
| WS 缺少 clarification 消息 | `event-stream.ts:30` | `clarification-answer` 无法从客户端传入 |

---

## 设计决策

### 决策一：blocked 子类型放在 WorkSession 字段，不修改 SessionState 枚举

**选项 A**：新增顶层 session 状态（`pending-clarification`、`pending-approval`）
**选项 B**：在 `WorkSession` 加 `blockedReason` 字段，保持 `SessionState = "blocked"`（**采用**）

理由：
- SessionState 枚举是 contract，改动会级联影响所有 switch 分支
- `blocked` 语义本来就是"暂停等待人类"，子类型是细节，不是新状态
- `blockedReason` 字段为 optional，向后兼容

```ts
// work-contracts/src/types.ts 新增

// RiskLevel 从 security 包下沉到 work-contracts（security 改为从此处 re-export）
// 避免跨包复制同一类型造成漂移
export type RiskLevel = "safe" | "consequential" | "dangerous";

export type BlockedKind =
  | 'clarification-required'
  | 'approval-required'
  | 'verification-failed'
  | 'paused-by-operator';

// ApprovalFingerprint：审批时只存最小可执行描述 + 确定性指纹，不存完整 Action
export interface ApprovalFingerprint {
  actionId: string;            // 待审批 action 的 id
  actionType: ActionType;      // action 类型
  fingerprint: string;         // 基于 action.type + action.params 计算的确定性哈希
}

export interface BlockedReason {
  kind: BlockedKind;
  question?: string;           // clarification-required
  approval?: ApprovalFingerprint;  // approval-required（轻量，不存完整 Action）
  riskLevel?: RiskLevel;       // approval-required
  evidence?: string;           // verification-failed
  verificationDetails?: EvidenceItem[];  // verification-failed 的结构化证据
}

// WorkSession 新增字段
export interface WorkSession {
  // ... 现有字段 ...
  blockedReason?: BlockedReason;  // 仅在 state === "blocked" 时有值
}
```

> **Review 修正（Codex round 3）**：
> - `pendingAction?: Action` 改为 `approval?: ApprovalFingerprint` — 持久化完整 Action 对象过重且脆弱，只需 actionId + type + 确定性指纹
> - `RiskLevel` 下沉到 work-contracts 作为 source of truth，security 包改为 re-export，消除同步漂移风险
> - 新增 `verificationDetails?: EvidenceItem[]` — verification-failed 需要结构化证据，不只是 string

### 决策二：engine 主导恢复流，gateway 只传参数

**选项 A**：gateway `resume` 直接调 `engine.executeGoal({ resumeFrom })`（**采用**）
**选项 B**：gateway 重建完整的 goal + options 再调用 engine

理由：
- engine 已有 `executeGoal` + `restoreSession` 完整路径，只需把注入的答案/决定带进去
- `ContextPayload` 可以携带澄清答案，engine 在 `restoreSession` 后 `loadContext` 时注入
- gateway 不需要知道 goal 的具体内容，只需要 sessionId + 注入载荷

```
gateway resume 流程：
  1. load session（验证 state === "blocked"）
  2. 调用 engine.resumeBlockedSession(sessionId, resumeInput)
  3. engine 内部（原子性保护）：
     a. 验证 session.state === "blocked"
     b. 原子转换 session.state → "active"，清除 blockedReason（CAS 语义）
     c. saveSession（此时重复 resume 请求会因 state !== "blocked" 而被拒绝）
     d. load snapshot → hydrateSession → injectResumeInput → 重入 runLoop
```

> **Review 修正（Codex round 3）**：增加原子性保护。
> resume 先将 state 从 blocked 原子转为 active 并持久化，再执行恢复。
> 重复 resume 请求在 step (a) 被拒绝，防止 snapshot 重放和 action 重执行。

### 决策三：Approval 使用 fingerprint 模型，恢复后仍走 policy 评估

> **Review 修正（Codex round 3）**：原设计为"审批后跳过 policy check"，Codex 指出这会打穿安全层。
> 修正为：approval 绑定到精确的 action fingerprint，resume 时仍经过 policy 评估，
> 但 policy 在匹配到已审批 fingerprint 时返回 `allowed: true`。

`PolicyDecision.requiresConfirmation` 已存在，`engine.ts:198` 已判断但立即 block。
`SecurityPolicy.approveForSession(actionPattern)` 已存在（[policy.ts:22](../../packages/security/src/policy.ts)）。

设计上利用已有的 `approveForSession` 机制：

```
executeAction 流程变化：
  if (decision.requiresConfirmation):
    → 计算 action fingerprint（type + params hash）
    → blockSession with kind='approval-required', approval={actionId, actionType, fingerprint}
    → return (等待人工)

resumeBlockedSession with approvalDecision='approve':
    → policy.approveForSession(fingerprint)  ← 注册精确审批
    → hydrateSession → 重入 runLoop
    → runLoop 中 requestNextAction 重新获得相同 action
    → executeAction → policy.evaluate → 命中已审批 fingerprint → allowed: true
    → 正常 execute

resumeBlockedSession with approvalDecision='reject':
    → ingest tool result as failed（通知 model 审批被拒绝）
    → 继续 runLoop（让 model 决定下一步）
```

**安全保证**：
- 审批仅对精确匹配的 fingerprint 有效，不是通用 bypass
- `PlatformPolicy.approveForSession()` 当前是 no-op，platform profile 下任何审批请求仍被拒绝
- 审批只在当前 session 生效，不跨 session 泄漏

### 决策四：WS 新增 clarification 消息类型，不新增 HTTP 端点

WS 通道已双向，增量最小：

```ts
// event-stream.ts 新增消息类型
interface ClarificationMessage {
  type: "clarification";
  answer: string;
}
```

CLI 模式通过 stdin 等待输入（polling 或 readline），不依赖 WS。

---

## 架构变更总览

```
work-contracts/src/types.ts
  + RiskLevel（从 security 包下沉至此，作为 source of truth）
  + BlockedKind, BlockedReason, ApprovalFingerprint
  + WorkSession.blockedReason?: BlockedReason

security/src/policy.ts
  ~ RiskLevel: 改为从 @octopus/work-contracts re-export（消除重复定义）

work-core/src/engine.ts
  + resumeBlockedSession(sessionId, input)  ← 唯一公开 resume 入口
  + computeActionFingerprint(action)  ← 确定性 hash
  ~ executeAction: requiresConfirmation → 计算 fingerprint → blockSession(approval-required)
  ~ blockSession: 写入 blockedReason 到 session
  ~ resumeBlockedSession: 原子 state 转换 → hydrate → runLoop

state-store: session.json 自动包含 blockedReason（随 session 序列化）

agent-runtime/src/types.ts
  + ResumeInput（携带 clarification answer 或 approval decision）
  ~ SessionPlane.resumeSession(id, input?: ResumeInput)

runtime-embedded/src/runtime.ts
  ~ resumeSession: 实现 session 内存状态恢复

gateway/src/routes/control.ts
  ~ resume: 改为调用 engine.resumeBlockedSession

gateway/src/ws/event-stream.ts
  + ClarificationMessage 类型
  ~ handleMessage: 处理 clarification 消息

surfaces-web/src/components/SessionDetail.tsx
  ~ blocked 状态展示：根据 blockedReason.kind 渲染不同 UI
  + ClarificationDialog（问答输入框）
  + ApprovalDialog（已有，升级为使用 blockedReason.approval）

surfaces-cli/src/cli.ts
  ~ octopus status: 展示 blockedReason
  + octopus resume --answer "..." 命令
  + octopus resume --approve / --reject 命令
  + octopus checkpoints <session-id> 命令
  + octopus rollback <session-id> [snapshot-id] 命令
```

---

## 数据流

### Clarification 恢复流

```
[Agent] → runtime.requestNextAction → {kind:"clarification", question:"..."}
[engine] → blockSession(kind='clarification-required', question)
         → session.blockedReason = {kind, question}
         → captureSnapshot()
         → saveSession()  ← blockedReason 持久化

[Web UI] ← WS session.blocked event (含 blockedReason)
[Web UI] → 渲染 ClarificationDialog
[User]   → 输入答案
[Web UI] → WS {type:"clarification", answer:"..."}
[Gateway] → engine.resumeBlockedSession(id, {kind:'clarification', answer})
[engine] → hydrateSession(latestSnapshot)
          → loadContext(id, {...existingContext, clarificationAnswer: answer})
          → runLoop() 继续
```

### Approval 恢复流

```
[engine.executeAction] → policy.evaluate → {requiresConfirmation: true}
[engine] → 计算 fingerprint = hash(action.type, action.params)
         → blockSession(kind='approval-required', approval={actionId, actionType, fingerprint}, riskLevel)
         → captureSnapshot()

[Web UI] → 渲染 ApprovalDialog（显示 actionType + riskLevel）
[User]   → 点击批准
[Web UI] → WS {type:"approval", promptId, action:"approve"}
[Gateway] → engine.resumeBlockedSession(id, {kind:'approval', decision:'approve'})
[engine] → policy.approveForSession(fingerprint)  ← 注册精确审批
         → hydrateSession(latestSnapshot)
         → 清除 session.blockedReason（原子操作，标记已消费）
         → runLoop() 继续
         → requestNextAction → 相同 action
         → executeAction → policy.evaluate → 命中审批 → allowed: true
         → 正常 execute
```

> 审批后 action **仍经过 policy 评估**，只是 policy 内部匹配到已注册的 fingerprint 而放行。
> 如果 model 返回了不同的 action，fingerprint 不匹配，policy 会再次要求确认。

### CLI Rollback 流

```
octopus checkpoints <session-id>
  → stateStore.listSnapshots(sessionId)
  → 输出快照列表（时间、状态）

octopus rollback <session-id> [snapshot-id]
  → engine.executeGoal({resumeFrom: {sessionId, snapshotId}})
  → 从指定快照恢复，重新执行
```

---

## 边界条件

| 场景 | 处理方式 |
| --- | --- |
| resume 时 session 不在 blocked 状态 | 返回 400，不执行（含重复 resume 场景） |
| 并发重复 resume 请求 | 先到者原子转换 state → active，后到者在 state check 被拒绝 |
| resume 时无 snapshot | 返回 409，提示需要先 pause 再 resume |
| 审批拒绝后 model 仍尝试同类 action | policy 再次触发（fingerprint 不匹配），循环 block/approve |
| 审批后 model 返回不同 action | fingerprint 不匹配，policy 重新要求确认 |
| clarification 答案为空 | 客户端校验，不允许发送空答案 |
| CLI 模式收到 approval-required | 打印 action 详情，等待 stdin y/n |
| vibe profile + requiresConfirmation | vibe profile 的 requiresConfirmation 始终为 false，直接 auto-execute |

---

## 不在范围内

- Token Budget：单独作为 Risk Gate 的子功能，此 Sprint 不做
- CLI 长轮询：CLI resume 通过命令行参数一次性传入，不做持久连接
- Approval 记忆（`approveForSession`）：已有接口但不扩展，此 Sprint 不做

---

## Review Record

### Codex Plan Review — 2026-03-20

| 维度 | 原始评分 | 修正 |
| --- | --- | --- |
| 正确性 | 7/10 | 原子 resume 防重入 + verification-failed 路径补全 |
| 简洁性 | 6/10 | ApprovalFingerprint 替代完整 Action 对象 |
| 安全性 | 5/10 | **关键修正**：fingerprint 审批模型取代 policy bypass |
| 规范性 | 8/10 | RiskLevel 下沉到 work-contracts 消除漂移 |

5 项采纳详见 implementation plan 的 Review Record 章节。
