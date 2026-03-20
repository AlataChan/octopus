# 路线一：人机协作恢复闭环 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 blocked session 是死胡同的问题，实现完整的"block → 人工介入 → resume"闭环

**Architecture:** RiskLevel 下沉到 work-contracts 作为 source of truth；在 work-contracts 加 BlockedReason + ApprovalFingerprint 子类型；engine 新增 `resumeBlockedSession` 方法（原子性保护 + fingerprint 审批模型）主导恢复流；gateway control 路径改为调 engine；WS 新增 clarification 消息；Web UI 和 CLI 各自展示差异化的 blocked 交互。

**Tech Stack:** TypeScript, Node.js, Preact (web), Commander.js (CLI), ws (WebSocket)

---

## 文件变更地图

| 文件 | 操作 | 职责 |
| --- | --- | --- |
| `packages/work-contracts/src/types.ts` | 修改 | 新增 RiskLevel（下沉）、BlockedKind、ApprovalFingerprint、BlockedReason；WorkSession 加 blockedReason 字段 |
| `packages/work-contracts/src/index.ts` | 修改 | 导出新类型 |
| `packages/security/src/policy.ts` | 修改 | RiskLevel 改为从 @octopus/work-contracts re-export |
| `packages/agent-runtime/src/types.ts` | 修改 | 新增 ResumeInput，更新 SessionPlane.resumeSession 签名 |
| `packages/runtime-embedded/src/runtime.ts` | 修改 | 实现 resumeSession（恢复内存状态） |
| `packages/work-core/src/engine.ts` | 修改 | 新增 resumeBlockedSession（原子性保护）+ computeActionFingerprint；executeAction 处理 requiresConfirmation（fingerprint 模型）；blockSession 写 blockedReason |
| `packages/work-core/src/index.ts` | 修改 | 导出新方法 |
| `packages/state-store/src/session-serde.ts` | 修改 | blockedReason 序列化/反序列化 |
| `packages/gateway/src/routes/control.ts` | 修改 | resume 改为调 engine.resumeBlockedSession |
| `packages/gateway/src/ws/event-stream.ts` | 修改 | 新增 ClarificationMessage 处理 |
| `packages/surfaces-web/src/components/SessionDetail.tsx` | 修改 | blocked 状态根据 kind 渲染不同 UI |
| `packages/surfaces-web/src/components/ClarificationDialog.tsx` | 新建 | 澄清问答输入框组件 |
| `packages/surfaces-cli/src/cli.ts` | 修改 | 新增 resume、checkpoints、rollback 命令 |

**测试文件：**

| 文件 | 操作 |
| --- | --- |
| `packages/work-contracts/src/__tests__/blocked-reason.test.ts` | 新建 |
| `packages/work-core/src/__tests__/engine-resume.test.ts` | 新建 |
| `packages/security/src/__tests__/policy-reexport.test.ts` | 新建（验证 RiskLevel re-export） |
| `packages/gateway/src/__tests__/control-resume.test.ts` | 修改 |
| `packages/gateway/src/__tests__/ws-clarification.test.ts` | 新建 |
| `packages/surfaces-cli/src/__tests__/cli-resume.test.ts` | 修改 |

---

## Task 1: BlockedReason + ApprovalFingerprint + RiskLevel 类型定义

> **Review 修正（Codex）**：
> - RiskLevel 下沉到 work-contracts 作为 source of truth，security 包改为 re-export
> - `pendingAction?: Action` 改为 `approval?: ApprovalFingerprint`（轻量指纹，不存完整 Action）
> - 新增 `verificationDetails` 字段用于 verification-failed 结构化证据

**Files:**
- Modify: `packages/work-contracts/src/types.ts`
- Modify: `packages/work-contracts/src/index.ts`
- Modify: `packages/security/src/policy.ts` — RiskLevel 改为从 work-contracts re-export
- Create: `packages/work-contracts/src/__tests__/blocked-reason.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/work-contracts/src/__tests__/blocked-reason.test.ts
import { describe, expect, it } from "vitest";
import type { BlockedReason, ApprovalFingerprint, RiskLevel, WorkSession } from "../types.js";
import { createWorkSession, createWorkGoal } from "../index.js";

describe("BlockedReason", () => {
  it("WorkSession.blockedReason is optional", () => {
    const goal = createWorkGoal({ description: "test", constraints: [], successCriteria: [] });
    const session = createWorkSession(goal);
    expect(session.blockedReason).toBeUndefined();
  });

  it("accepts clarification-required kind", () => {
    const reason: BlockedReason = { kind: "clarification-required", question: "Which path?" };
    expect(reason.kind).toBe("clarification-required");
    expect(reason.question).toBe("Which path?");
  });

  it("accepts approval-required kind with ApprovalFingerprint", () => {
    const approval: ApprovalFingerprint = {
      actionId: "act-1",
      actionType: "shell",
      fingerprint: "sha256:abc123"
    };
    const reason: BlockedReason = {
      kind: "approval-required",
      approval,
      riskLevel: "dangerous",
    };
    expect(reason.kind).toBe("approval-required");
    expect(reason.approval?.fingerprint).toBe("sha256:abc123");
    expect(reason.riskLevel).toBe("dangerous");
  });

  it("accepts verification-failed kind with structured evidence", () => {
    const reason: BlockedReason = {
      kind: "verification-failed",
      evidence: "type-check failed",
      verificationDetails: [{ check: "tsc", passed: false, output: "TS2345" }],
    };
    expect(reason.verificationDetails).toHaveLength(1);
  });
});

describe("RiskLevel (source of truth in work-contracts)", () => {
  it("accepts all valid risk levels", () => {
    const levels: RiskLevel[] = ["safe", "consequential", "dangerous"];
    expect(levels).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/work-contracts test
```

Expected: 类型错误或 import 失败

- [ ] **Step 3: 实现类型**

在 `packages/work-contracts/src/types.ts` 的 `WorkSession` 接口之前添加：

```ts
// RiskLevel 下沉到此处作为 source of truth（原在 @octopus/security）
export type RiskLevel = "safe" | "consequential" | "dangerous";

export type BlockedKind =
  | "clarification-required"
  | "approval-required"
  | "verification-failed"
  | "paused-by-operator";

// 审批指纹：轻量描述 + 确定性哈希，不存完整 Action 对象
export interface ApprovalFingerprint {
  actionId: string;
  actionType: ActionType;
  fingerprint: string;     // 基于 action.type + action.params 计算的确定性哈希
}

// verification-failed 的结构化证据条目
export interface EvidenceItem {
  check: string;
  passed: boolean;
  output?: string;
}

export interface BlockedReason {
  kind: BlockedKind;
  question?: string;                    // clarification-required
  approval?: ApprovalFingerprint;       // approval-required
  riskLevel?: RiskLevel;                // approval-required
  evidence?: string;                    // verification-failed（简要）
  verificationDetails?: EvidenceItem[]; // verification-failed（结构化）
}
```

在 `WorkSession` 接口末尾添加：

```ts
  blockedReason?: BlockedReason;
```

在 `packages/work-contracts/src/index.ts` 中添加导出：

```ts
export type { BlockedKind, BlockedReason, ApprovalFingerprint, EvidenceItem, RiskLevel } from "./types.js";
```

- [ ] **Step 4: security 包 re-export RiskLevel**

在 `packages/security/src/policy.ts` 中：
- 删除本地的 `export type RiskLevel = ...` 定义
- 改为：`export type { RiskLevel } from "@octopus/work-contracts";`

确保 `packages/security/package.json` 的 dependencies 中已有 `@octopus/work-contracts`（检查，如无需添加）。

- [ ] **Step 5: 运行测试，确认通过**

```bash
pnpm --filter @octopus/work-contracts test
pnpm --filter @octopus/security run type-check
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/work-contracts/src/types.ts packages/work-contracts/src/index.ts packages/work-contracts/src/__tests__/blocked-reason.test.ts packages/security/src/policy.ts
git commit -m "feat: add BlockedReason/ApprovalFingerprint types, move RiskLevel to work-contracts"
```

---

## Task 2: ResumeInput 协议定义（agent-runtime）

**Files:**
- Modify: `packages/agent-runtime/src/types.ts`
- Modify: `packages/agent-runtime/src/index.ts`（如有）

- [ ] **Step 1: 写失败测试**

```ts
// packages/agent-runtime/src/__tests__/resume-input.test.ts
import { describe, expect, it } from "vitest";
import type { ResumeInput } from "../types.js";

describe("ResumeInput", () => {
  it("accepts clarification kind", () => {
    const input: ResumeInput = { kind: "clarification", answer: "Yes, use /tmp" };
    expect(input.kind).toBe("clarification");
  });

  it("accepts approval kind with approve decision", () => {
    const input: ResumeInput = { kind: "approval", decision: "approve" };
    expect(input.decision).toBe("approve");
  });

  it("accepts approval kind with reject decision", () => {
    const input: ResumeInput = { kind: "approval", decision: "reject" };
    expect(input.decision).toBe("reject");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/agent-runtime test
```

- [ ] **Step 3: 实现 ResumeInput，更新 SessionPlane 签名**

在 `packages/agent-runtime/src/types.ts` 添加：

```ts
export type ResumeInput =
  | { kind: "clarification"; answer: string }
  | { kind: "approval"; decision: "approve" | "reject" }
  | { kind: "operator" };   // paused-by-operator 恢复，无额外载荷
```

更新 `SessionPlane` 接口：

```ts
resumeSession(sessionId: string, input?: ResumeInput): Promise<void>;
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm --filter @octopus/agent-runtime test
```

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/types.ts packages/agent-runtime/src/__tests__/resume-input.test.ts
git commit -m "feat: add ResumeInput protocol to agent-runtime"
```

---

## Task 3: EmbeddedRuntime.resumeSession 实现

**Files:**
- Modify: `packages/runtime-embedded/src/runtime.ts`
- Modify: `packages/runtime-embedded/src/__tests__/runtime.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/runtime-embedded/src/__tests__/runtime.test.ts` 找到现有的 resumeSession 测试（如有）或新增：

```ts
describe("resumeSession", () => {
  it("restores session state from snapshot after pause", async () => {
    const runtime = new EmbeddedRuntime(testConfig, mockClient, eventBus);
    const goal = createWorkGoal({ description: "test", constraints: [], successCriteria: [] });
    const session = await runtime.initSession(goal);

    // 快照保存后删除内存状态
    const snapshot = await runtime.snapshotSession(session.id);
    await runtime.cancelSession(session.id);  // 清除内存

    // resume 应该恢复
    await runtime.resumeSession(session.id, { kind: "operator" });
    // 恢复后应能 requestNextAction（或不抛 Unknown session）
    // 注意：测试模式下 allowModelApiCall 为 false，验证 session 存在即可
    const meta = await runtime.getMetadata(session.id);
    expect(meta.runtimeType).toBe("embedded");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/runtime-embedded test
```

- [ ] **Step 3: 实现 resumeSession**

在 `packages/runtime-embedded/src/runtime.ts` 中 `resumeSession` 方法：

```ts
async resumeSession(sessionId: string, _input?: ResumeInput): Promise<void> {
  // 如果 session 已在内存中（pause 场景），直接返回
  if (this.sessions.has(sessionId)) {
    return;
  }
  // session 不在内存（进程重启/新进程 resume 场景）
  // 此时 engine 会通过 restoreSession 重新 hydrateSession，这里只需标记无需额外操作
  // 实际恢复由 engine.resumeBlockedSession 通过 executeGoal({resumeFrom}) 完成
}
```

> 说明：EmbeddedRuntime 的 session 是纯内存的。resume 的真实恢复工作由 engine 的 `restoreSession` 承担（已实现），`resumeSession` 在这里只是接口履约。如果未来需要持久化 runtime 状态（如跨进程），在此处扩展。

- [ ] **Step 4: 类型检查通过**

```bash
pnpm --filter @octopus/runtime-embedded run type-check
pnpm --filter @octopus/runtime-embedded test
```

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-embedded/src/runtime.ts packages/runtime-embedded/src/__tests__/runtime.test.ts
git commit -m "feat: implement resumeSession in EmbeddedRuntime"
```

---

## Task 4: Engine — blockSession 写 blockedReason + resumeBlockedSession（原子性 + fingerprint）

> **Review 修正（Codex）**：
> - resumeBlockedSession 必须原子转换 state（blocked → active）并持久化后才进入恢复流，防止重复 resume 重放
> - approval 后不跳过 policy check，而是通过 `policy.approveForSession(fingerprint)` 注册精确审批，resume 后 action 仍经过 policy 评估
> - requiresConfirmation 分支需计算 action fingerprint 并存入 blockedReason.approval
> - buildBlockedReason 需要处理 verification-failed 路径（从 completion/plugin 结果构建）

**Files:**
- Modify: `packages/work-core/src/engine.ts`
- Create: `packages/work-core/src/__tests__/engine-resume.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/work-core/src/__tests__/engine-resume.test.ts
import { describe, expect, it, vi } from "vitest";
// 使用项目现有的 test helper 模式（参考 engine.test.ts）

describe("blockSession writes blockedReason", () => {
  it("writes clarification kind when runtime returns clarification", async () => {
    // 构造 runtime mock 返回 {kind:"clarification", question:"Which dir?"}
    // 执行 executeGoal
    // 验证 session.state === "blocked"
    // 验证 session.blockedReason?.kind === "clarification-required"
    // 验证 session.blockedReason?.question === "Which dir?"
  });

  it("writes approval-required kind with ApprovalFingerprint when policy requiresConfirmation", async () => {
    // policy mock: requiresConfirmation = true, riskLevel = "dangerous"
    // runtime mock 返回一个 action
    // 验证 session.blockedReason?.kind === "approval-required"
    // 验证 session.blockedReason?.approval?.fingerprint 存在且非空
    // 验证 session.blockedReason?.approval?.actionType 匹配 action.type
    // 验证 session.blockedReason?.riskLevel === "dangerous"
  });

  it("writes verification-failed kind with evidence from completion results", async () => {
    // runtime mock 返回 verification failure
    // 验证 session.blockedReason?.kind === "verification-failed"
    // 验证 session.blockedReason?.evidence 非空
    // 验证 session.blockedReason?.verificationDetails 包含结构化条目
  });
});

describe("computeActionFingerprint", () => {
  it("produces deterministic hash for same action type + params", () => {
    // 相同 type + params → 相同 fingerprint
  });

  it("produces different hash for different params", () => {
    // 不同 params → 不同 fingerprint
  });
});

describe("resumeBlockedSession", () => {
  it("atomically transitions state before hydration (prevents duplicate resume)", async () => {
    // 先让 session blocked
    // 调用 resumeBlockedSession
    // 验证 session.state 在 hydrate 之前已变为非 blocked
    // 验证 session.blockedReason 已被清除
    // 验证 stateStore.saveSession 在 hydrate 之前被调用
  });

  it("re-enters runLoop after clarification answer injected", async () => {
    // 先让 session blocked（clarification-required）
    // 调用 engine.resumeBlockedSession(id, {kind:"clarification", answer:"yes"})
    // 验证 runtime 的 loadContext 被调用，含 clarificationAnswer
    // 验证 runLoop 继续执行
  });

  it("registers approval fingerprint with policy before re-entering runLoop", async () => {
    // 先让 session blocked（approval-required, fingerprint="sha256:abc"）
    // 调用 engine.resumeBlockedSession(id, {kind:"approval", decision:"approve"})
    // 验证 policy.approveForSession 被调用，参数为 "sha256:abc"
    // 验证 runLoop 继续执行
    // 验证 action 仍经过 policy.evaluate（不跳过）
  });

  it("rejects concurrent duplicate resume", async () => {
    // 先让 session blocked
    // 并发调用两次 resumeBlockedSession
    // 第一次成功，第二次应抛出 "Session is not blocked"
  });

  it("throws if session is not blocked", async () => {
    // session 在 active 状态
    // resumeBlockedSession 应抛出 "Session is not blocked"
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/work-core test
```

- [ ] **Step 3: 实现 computeActionFingerprint**

在 `engine.ts` 底部添加辅助函数：

```ts
import { createHash } from "node:crypto";

function computeActionFingerprint(action: Action): string {
  const payload = JSON.stringify({ type: action.type, params: action.params });
  return "sha256:" + createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: 修改 blockSession，写入 blockedReason**

在 `engine.ts` 的 `blockSession` 方法中，构建并写入 `blockedReason`：

```ts
private async blockSession(
  session: WorkSession,
  goal: WorkGoal,
  reason: string,
  workspaceRoot: string | undefined,
  payload: EventPayloadByType["session.blocked"]
): Promise<WorkSession> {
  // 新增：构建 blockedReason
  session.blockedReason = buildBlockedReason(payload);

  transitionSession(session, "blocked", reason);
  await this.writeVisibleState(goal, session, workspaceRoot, payload.clarification ? "Clarification requested" : "Await user input");
  await this.stateStore.saveSession(session);
  this.emit(session, "session.blocked", "work-core", payload);
  await this.captureSnapshot(session);
  return session;
}
```

在文件底部添加辅助函数：

```ts
function buildBlockedReason(payload: EventPayloadByType["session.blocked"]): BlockedReason {
  if (payload.clarification) {
    return { kind: "clarification-required", question: payload.clarification };
  }
  // approval-required：此路径由 executeAction 的 requiresConfirmation 分支直接构建
  // buildBlockedReason 不处理此 case（fingerprint 在 executeAction 中计算）
  if (payload.riskLevel) {
    return { kind: "approval-required", riskLevel: payload.riskLevel as RiskLevel };
  }
  // verification-failed：从 payload 中提取结构化证据
  if (payload.reason?.includes("verification")) {
    return {
      kind: "verification-failed",
      evidence: payload.reason,
      // 如果 payload 携带结构化结果，在此解析
    };
  }
  return { kind: "paused-by-operator" };
}
```

- [ ] **Step 5: 修改 executeAction 的 requiresConfirmation 分支**

在 `engine.ts` 的 `executeAction` 方法，找到：

```ts
if (!decision.allowed || decision.requiresConfirmation) {
  transitionSession(session, "blocked", decision.reason);
  ...
```

修改为：

```ts
if (!decision.allowed) {
  transitionSession(session, "blocked", decision.reason);
  await this.stateStore.saveSession(session);
  this.emit(session, "session.blocked", "work-core", {
    actionId: action.id,
    reason: decision.reason,
    riskLevel: decision.riskLevel
  });
  await this.captureSnapshot(session);
  return true;
}

if (decision.requiresConfirmation) {
  // 计算 action fingerprint 并存入 blockedReason（轻量，不存完整 Action）
  const fingerprint = computeActionFingerprint(action);
  session.blockedReason = {
    kind: "approval-required",
    approval: {
      actionId: action.id,
      actionType: action.type,
      fingerprint,
    },
    riskLevel: decision.riskLevel,
  };
  transitionSession(session, "blocked", decision.reason);
  await this.stateStore.saveSession(session);
  this.emit(session, "session.blocked", "work-core", {
    actionId: action.id,
    reason: decision.reason,
    riskLevel: decision.riskLevel
  });
  await this.captureSnapshot(session);
  return true;
}
```

- [ ] **Step 6: 实现 resumeBlockedSession 公开方法（原子性保护 + fingerprint 审批）**

在 `WorkEngine` class 中新增方法（放在 `pauseSession` 之后）：

```ts
async resumeBlockedSession(
  sessionId: string,
  input: ResumeInput,
  options: ExecuteGoalOptions = {}
): Promise<WorkSession> {
  const session = await this.stateStore.loadSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  if (session.state !== "blocked") {
    throw new Error(`Session ${sessionId} is not blocked (current state: ${session.state})`);
  }

  // ── 原子性保护 ──
  // 先转换 state 并持久化，防止重复 resume 重放 snapshot
  const blockedReason = session.blockedReason;  // 保存一份，后续使用
  session.blockedReason = undefined;            // 标记已消费
  transitionSession(session, "active", "Resuming from blocked state");
  await this.stateStore.saveSession(session);
  // 此时并发的 resume 请求会在上面的 state !== "blocked" 检查被拒绝

  // ── Approval fingerprint 注册 ──
  if (input.kind === "approval" && input.decision === "approve" && blockedReason?.approval) {
    // 通过已有的 approveForSession 机制注册精确审批
    // policy 在后续 evaluate 时匹配到此 fingerprint 会返回 allowed: true
    await this.policy.approveForSession(blockedReason.approval.fingerprint);
  }

  const snapshot = await this.stateStore.loadSnapshot(sessionId);
  if (!snapshot) {
    throw new Error(`No snapshot found for session ${sessionId}. Cannot resume.`);
  }

  // 构造 resumeGoal（从 snapshot 恢复 goal 描述）
  const resumeGoal = createWorkGoal({
    id: snapshot.session.goalId,
    description: snapshot.session.goalSummary ?? "Resumed session",
    constraints: [],
    successCriteria: []
  });

  // 构造额外 context（注入 resume 信息给 model）
  const injectContext = buildResumeContext(input);

  return this.executeGoal(resumeGoal, {
    ...options,
    resumeFrom: { sessionId, snapshotId: snapshot.snapshotId },
    _resumeInput: input,
    _injectContext: injectContext
  });
}
```

> **安全保证**：
> - approval 后 action 仍经过 `policy.evaluate`，不跳过安全层
> - `approveForSession` 只对精确 fingerprint 有效，不同 action 不匹配
> - `PlatformPolicy.approveForSession()` 是 no-op，platform profile 下审批无效
> - 原子 state 转换防止重复 resume 重放 snapshot

- [ ] **Step 7: 运行测试，确认通过**

```bash
pnpm --filter @octopus/work-core test
pnpm --filter @octopus/work-core run type-check
```

- [ ] **Step 8: Commit**

```bash
git add packages/work-core/src/engine.ts packages/work-core/src/__tests__/engine-resume.test.ts
git commit -m "feat: engine resumeBlockedSession with atomic state guard and fingerprint approval"
```

---

## Task 5: state-store blockedReason 序列化

**Files:**
- Modify: `packages/state-store/src/session-serde.ts`
- Modify: `packages/state-store/src/__tests__/store.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/state-store/src/__tests__/store.test.ts` 新增：

```ts
it("round-trips blockedReason through save/load", async () => {
  const session = makeTestSession();
  session.state = "blocked";
  session.blockedReason = {
    kind: "clarification-required",
    question: "Which directory should I use?"
  };

  await store.saveSession(session);
  const loaded = await store.loadSession(session.id);

  expect(loaded?.blockedReason?.kind).toBe("clarification-required");
  expect(loaded?.blockedReason?.question).toBe("Which directory should I use?");
});

it("loads session without blockedReason as undefined", async () => {
  const session = makeTestSession();
  await store.saveSession(session);
  const loaded = await store.loadSession(session.id);
  expect(loaded?.blockedReason).toBeUndefined();
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/state-store test
```

- [ ] **Step 3: 修改 session-serde.ts**

在 `StoredWorkSession` 类型中添加：

```ts
blockedReason?: {
  kind: string;
  question?: string;
  riskLevel?: string;
  evidence?: string;
};
```

在 `serializeWorkSession` 中添加：

```ts
blockedReason: session.blockedReason,
```

在 `hydrateWorkSession` 中添加：

```ts
blockedReason: stored.blockedReason as BlockedReason | undefined,
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm --filter @octopus/state-store test
```

- [ ] **Step 5: Commit**

```bash
git add packages/state-store/src/session-serde.ts packages/state-store/src/__tests__/store.test.ts
git commit -m "feat: serialize/deserialize blockedReason in state-store"
```

---

## Task 6: Gateway control.ts — resume 改为调 engine

**Files:**
- Modify: `packages/gateway/src/routes/control.ts`
- Modify: `packages/gateway/src/__tests__/control-resume.test.ts`（现有文件）

- [ ] **Step 1: 写失败测试**

在 `packages/gateway/src/__tests__/control-resume.test.ts` 新增：

```ts
it("resume calls engine.resumeBlockedSession, not runtime.resumeSession", async () => {
  const resumeBlockedSession = vi.fn().mockResolvedValue({ state: "active" });
  const deps = makeTestDeps({ engine: { resumeBlockedSession, pauseSession: vi.fn() } });

  await handleControl(deps, testOperator, "session-1", { action: "resume" });

  expect(resumeBlockedSession).toHaveBeenCalledWith("session-1", { kind: "operator" });
  // runtime.resumeSession 不应被直接调用
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/gateway test -- --testPathPattern=control
```

- [ ] **Step 3: 修改 control.ts**

将 resume 分支改为：

```ts
if (body.action === "resume") {
  await deps.engine.resumeBlockedSession(sessionId, { kind: "operator" });
  return { ok: true };
}
```

同时更新 `RouteDeps` 类型（如有 `engine` 字段），确认 `engine` 有 `resumeBlockedSession` 方法签名。

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm --filter @octopus/gateway test
pnpm --filter @octopus/gateway run type-check
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/routes/control.ts packages/gateway/src/__tests__/control-resume.test.ts
git commit -m "fix: gateway resume calls engine.resumeBlockedSession instead of runtime"
```

---

## Task 7: Gateway WS — 新增 clarification 消息

**Files:**
- Modify: `packages/gateway/src/ws/event-stream.ts`
- Create: `packages/gateway/src/__tests__/ws-clarification.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/gateway/src/__tests__/ws-clarification.test.ts
it("routes clarification message to engine.resumeBlockedSession", async () => {
  // 建立 WS 连接，发送 auth
  // 发送 {type:"clarification", answer:"yes, use /tmp"}
  // 验证 engine.resumeBlockedSession 被调用，含 {kind:"clarification", answer:"yes, use /tmp"}
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/gateway test -- --testPathPattern=ws-clarification
```

- [ ] **Step 3: 修改 event-stream.ts**

在 `EventStreamMessage` union type 中添加：

```ts
interface ClarificationMessage {
  type: "clarification";
  answer: string;
}

type EventStreamMessage = AuthMessage | ControlMessage | ApprovalMessage | ClarificationMessage;
```

在 `handleMessage` 函数中（`approval` 处理块之后）添加：

```ts
if (parsed.type === "clarification") {
  try {
    await deps.engine.resumeBlockedSession(sessionId, {
      kind: "clarification",
      answer: parsed.answer
    });
  } catch (error) {
    sendJson(socket, {
      type: "error",
      error: error instanceof Error ? error.message : "Failed to resume with clarification."
    });
  }
  return;
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter @octopus/gateway test
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ws/event-stream.ts packages/gateway/src/__tests__/ws-clarification.test.ts
git commit -m "feat: WS event-stream handles clarification message type"
```

---

## Task 8: Web UI — SessionDetail blocked 状态差异化展示

**Files:**
- Modify: `packages/surfaces-web/src/components/SessionDetail.tsx`
- Create: `packages/surfaces-web/src/components/ClarificationDialog.tsx`
- Modify: `packages/surfaces-web/src/__tests__/session-detail.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `packages/surfaces-web/src/__tests__/session-detail.test.tsx` 新增：

```ts
it("renders ClarificationDialog when session blocked with clarification-required", () => {
  const session = makeTestSession({
    state: "blocked",
    blockedReason: { kind: "clarification-required", question: "Which path?" }
  });
  const { getByText, getByRole } = render(<SessionDetail session={session} ... />);
  expect(getByText("Which path?")).toBeTruthy();
  expect(getByRole("textbox")).toBeTruthy(); // 答案输入框
});

it("renders ApprovalDialog when session blocked with approval-required", () => {
  const session = makeTestSession({
    state: "blocked",
    blockedReason: { kind: "approval-required", riskLevel: "dangerous" }
  });
  const { getByText } = render(<SessionDetail session={session} ... />);
  expect(getByText(/approve/i)).toBeTruthy();
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/surfaces-web test
```

- [ ] **Step 3: 新建 ClarificationDialog 组件**

```tsx
// packages/surfaces-web/src/components/ClarificationDialog.tsx
import { useState } from "preact/hooks";

interface ClarificationDialogProps {
  question: string;
  busy: boolean;
  onAnswer: (answer: string) => Promise<void>;
}

export function ClarificationDialog({ question, busy, onAnswer }: ClarificationDialogProps) {
  const [answer, setAnswer] = useState("");

  return (
    <div class="clarification-dialog card">
      <p class="clarification-question">{question}</p>
      <textarea
        class="clarification-input"
        value={answer}
        onInput={(e) => setAnswer((e.target as HTMLTextAreaElement).value)}
        placeholder="Enter your answer..."
        rows={3}
      />
      <button
        class="btn btn-primary"
        disabled={busy || answer.trim().length === 0}
        onClick={() => onAnswer(answer)}
      >
        {busy ? "Sending..." : "Submit Answer"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 修改 SessionDetail.tsx**

在 blocked 状态区域，根据 `session.blockedReason?.kind` 条件渲染：

```tsx
{session.state === "blocked" && session.blockedReason?.kind === "clarification-required" && (
  <ClarificationDialog
    question={session.blockedReason.question ?? "Please provide clarification."}
    busy={busy}
    onAnswer={onClarify}
  />
)}
{session.state === "blocked" && session.blockedReason?.kind === "approval-required" && (
  <ApprovalDialog
    approval={approval}
    busy={busy}
    onResolve={onResolveApproval}
  />
)}
```

同时向 `SessionDetailProps` 添加 `onClarify: (answer: string) => Promise<void>` prop。

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter @octopus/surfaces-web test
```

- [ ] **Step 6: Commit**

```bash
git add packages/surfaces-web/src/components/ClarificationDialog.tsx packages/surfaces-web/src/components/SessionDetail.tsx packages/surfaces-web/src/__tests__/session-detail.test.tsx
git commit -m "feat: SessionDetail renders ClarificationDialog and ApprovalDialog based on blockedReason"
```

---

## Task 9: CLI — resume / checkpoints / rollback 命令

**Files:**
- Modify: `packages/surfaces-cli/src/cli.ts`
- Modify: `packages/surfaces-cli/src/__tests__/cli-resume.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// 在现有 cli.test.ts 或新文件中

it("octopus resume --answer forwards clarification to engine", async () => {
  // mock engine.resumeBlockedSession
  // 调用 cli.parse(["resume", "session-1", "--answer", "yes"])
  // 验证 resumeBlockedSession 被调用，含 {kind:"clarification", answer:"yes"}
});

it("octopus resume --approve forwards approval to engine", async () => {
  // 调用 cli.parse(["resume", "session-1", "--approve"])
  // 验证 resumeBlockedSession 被调用，含 {kind:"approval", decision:"approve"}
});

it("octopus checkpoints <session-id> lists snapshots", async () => {
  // mock stateStore.listSnapshots
  // 验证输出包含快照 id 和时间
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
pnpm --filter @octopus/surfaces-cli test
```

- [ ] **Step 3: 添加 resume 命令**

在 `cli.ts` 中，在现有 `status` 命令之后添加：

```ts
program
  .command("resume <session-id>")
  .description("Resume a blocked session")
  .option("--answer <text>", "Provide clarification answer")
  .option("--approve", "Approve the pending action")
  .option("--reject", "Reject the pending action")
  .action(async (sessionId: string, opts: { answer?: string; approve?: boolean; reject?: boolean }) => {
    let resumeInput: ResumeInput;
    if (opts.answer) {
      resumeInput = { kind: "clarification", answer: opts.answer };
    } else if (opts.approve) {
      resumeInput = { kind: "approval", decision: "approve" };
    } else if (opts.reject) {
      resumeInput = { kind: "approval", decision: "reject" };
    } else {
      resumeInput = { kind: "operator" };
    }
    await engine.resumeBlockedSession(sessionId, resumeInput);
    console.log(`Session ${sessionId} resumed.`);
  });
```

- [ ] **Step 4: 添加 checkpoints 命令**

```ts
program
  .command("checkpoints <session-id>")
  .description("List available checkpoints for a session")
  .action(async (sessionId: string) => {
    const snapshots = await stateStore.listSnapshots(sessionId);
    if (snapshots.length === 0) {
      console.log("No checkpoints found.");
      return;
    }
    for (const snap of snapshots) {
      console.log(`${snap.snapshotId}  ${snap.capturedAt.toISOString()}`);
    }
  });
```

- [ ] **Step 5: 添加 rollback 命令**

```ts
program
  .command("rollback <session-id> [snapshot-id]")
  .description("Restore session from a checkpoint and re-execute")
  .action(async (sessionId: string, snapshotId?: string) => {
    const session = await stateStore.loadSession(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found.`);
      process.exit(1);
    }
    const goal = createWorkGoal({
      description: session.goalSummary ?? "Rolled back session",
      constraints: [],
      successCriteria: []
    });
    await engine.executeGoal(goal, { resumeFrom: { sessionId, snapshotId } });
  });
```

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @octopus/surfaces-cli test
pnpm --filter @octopus/surfaces-cli run type-check
```

- [ ] **Step 7: Commit**

```bash
git add packages/surfaces-cli/src/cli.ts packages/surfaces-cli/src/__tests__/cli-resume.test.ts
git commit -m "feat: CLI adds resume, checkpoints, rollback commands"
```

---

## Task 10: 全局验证

- [ ] **Step 1: 全量类型检查**

```bash
pnpm run type-check
```

Expected: 0 errors

- [ ] **Step 2: 全量测试**

```bash
pnpm test
```

Expected: All tests pass

- [ ] **Step 3: 端到端冒烟测试（手动）**

启动 gateway + web UI，创建一个 session，用 `safe-local` profile 触发一个 shell 操作，验证：
1. session 状态变为 `blocked`，Web UI 显示 ApprovalDialog（含 actionType + riskLevel）
2. 点击批准，session 继续执行（action 仍经过 policy 评估，不跳过）
3. 如果 runtime 返回 clarification，Web UI 显示 ClarificationDialog
4. 输入答案后，session 继续执行
5. `octopus checkpoints <id>` 能列出快照
6. `octopus rollback <id>` 能从快照恢复
7. 快速连续点两次批准，只有第一次生效（重复 resume 被拒绝）

- [ ] **Step 4: 最终 Commit（如有收尾改动）**

```bash
pnpm test
git add -p  # 只 stage 确认的文件
git commit -m "chore: route-1 human-agent resume loop complete"
```

---

## 验证命令（完成标准）

```bash
# 类型检查
pnpm run type-check

# 全量测试
pnpm test

# 关键包
pnpm --filter @octopus/work-contracts test
pnpm --filter @octopus/security run type-check   # 验证 RiskLevel re-export
pnpm --filter @octopus/work-core test
pnpm --filter @octopus/gateway test
pnpm --filter @octopus/surfaces-cli test
pnpm --filter @octopus/surfaces-web test
```

所有命令 exit 0，无测试失败，无类型错误。

---

## Review Record

### Codex Plan Review — 2026-03-20

| 维度 | 评分 | 修正后预期 |
| --- | --- | --- |
| 正确性 | 7/10 | 8+ （原子 resume + verification-failed 路径补全） |
| 简洁性 | 6/10 | 7+ （ApprovalFingerprint 替代完整 Action） |
| 安全性 | 5/10 | 8+ （fingerprint 审批模型，不跳过 policy） |
| 规范性 | 8/10 | 9  （RiskLevel 单一 source of truth） |

**采纳的修正：**

1. **[高] Approval 不跳过 policy** — 改为 fingerprint 模型：`approveForSession(fingerprint)` 注册精确审批，action 仍走 `policy.evaluate`
2. **[高] 原子性 resume** — `resumeBlockedSession` 先原子转换 `state → active` 并持久化，再 hydrate，防重复 resume 重放
3. **[中] RiskLevel 下沉** — 从 `@octopus/security` 移到 `@octopus/work-contracts` 作为 source of truth，security re-export
4. **[中] pendingAction → ApprovalFingerprint** — 不存完整 Action 对象，只存 `{actionId, actionType, fingerprint}`
5. **[中] verification-failed 结构化** — 新增 `EvidenceItem` 接口 + `verificationDetails` 字段，`buildBlockedReason` 补全此路径
