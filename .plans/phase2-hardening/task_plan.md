# Phase 2 Implementation Plan: Hardening & Automation

Status: v5 — Final consistency pass
Source: `docs/WORK_AGENT_ARCHITECTURE.md` + `.plans/PHASE_PLAN.md`
Scope: Phase 2 — Replay + visible planning + profile expansion + automation
Prerequisite: Phase 1 complete and code-reviewed (2026-03-16)

---

## Changelog from v1 (Codex Round 1 Review)

| # | Change | Reason |
| - | ------ | ------ |
| 1 | Snapshot/restore 责任层重划：`hydrateSession()` 进 SessionPlane；`SessionSnapshot` 含完整 runtimeContext；state-store = 持久化 only | 架构文档 §8.2 明确 snapshot/restore 是 Session Plane 职责；EmbeddedRuntime 内存状态外部无法访问 |
| 2 | platform profile 只信任全局/外部 policy file；workspace `.octopus/policy.json` = 文档，非权威 | workspace 可写内容自我授权 = 安全漏洞 |
| 3 | automation.json 拆成 goals registry + sources；source 只携带 namedGoalId | 同一 namedGoalId 多 source 时 goalDescription 分散，与架构 "stable binding key" 不一致 |
| 4 | automation 范围收窄：Phase 2 只做 cron + watcher；webhook + poller + daemon 推迟 Phase 3 | 架构文档 Phase 2 只说 "cron and event injection"；webhook 属于网络化阶段 |
| 5 | 新增 7 个 observability 事件类型覆盖 Phase 2 新能力 | 架构文档 §11.5："无法通过事件解释自己的 feature 还没设计完" |

## Changelog from v2 (Codex Round 2 Review)

| # | Change | Reason |
| - | ------ | ------ |
| 6 | 新事件类型归属改回 `observability`，不放 `work-contracts` | P1 已确立边界：`observability` 拥有事件模型；`work-contracts` 只含域类型 |
| 7 | automation + safe-local 死锁规则：`octopus automation run` 启动时检查 profile，`safe-local` → fail fast | `safe-local` 会触发阻塞终端交互确认，automation 无人值守场景必然死锁 |
| 8 | platform-loader 路径比较改用 `realpath` 后再比对 | 字符串前缀匹配可被 symlink 绕过 |
| 9 | dispatcher 运行时 missing namedGoalId → emit+skip；loader 启动时配置错误 → fail fast | 运行时一个坏 event 不应杀死整个 automation runner |
| 10 | 再增 2 组事件（source lifecycle + policy resolution），归属 `observability` | `profile.selected` 不足以解释 platform default-deny；source 生命周期无事件覆盖 |

## Changelog from v3 (Codex Round 3 Review)

| # | Change | Reason |
| - | ------ | ------ |
| 11 | `namedGoalId` 字段落地到 domain contract：`WorkGoal.namedGoalId?: string`，`SessionSummary.namedGoalId?: string`，`createWorkGoal` 支持 `namedGoalId` 入参，`StateStore` 加 `listSessions()` 返回携带该字段 | dispatcher 的 `sessions.find(s => s.namedGoalId === ...)` 需要 domain contract 支撑，否则编译期失败 |
| 12 | `restore --at` API 闭合：engine opts 扩展为 `{ resumeFrom?: { sessionId: string; snapshotId?: string } }`；CLI 的 `--at <ts>` 先调 `listSnapshots()` 选出 snapshotId 再传给 engine；engine 不感知时间戳 | 时间点选择是查询逻辑，属于 CLI 表层；engine 只接受已选定的 snapshotId |
| 13 | 明确 snapshot capture policy：在 `pauseSession()` 调用时、会话进入 `blocked` 状态时、automation dispatcher 发起 handoff 前自动 capture。**不** 每轮 action 后 capture | 无 capture policy → restore 接口对了但运行时无快照可用；每轮 capture 代价过高 |
| 14 | 移除 `messages: RuntimeMessage[]` 和 `RuntimeMessage` 类型；`runtimeContext` 只保存 `{ pendingResults, contextPayload }`；`ModelClient` 接口不变 | `HttpModelClient` 是无状态 turn executor，每轮单条 prompt，不维护对话历史；强加 messages Map 只会 snapshot 永远为空的死状态 |
| 15 | 修复 deliverable 表：2.6 package 列改为 `observability`（正文已是，表头滞后）；CLI 节"runs in-process with `octopus run`"改为"runs in-process with `octopus automation run`" | 措辞与实际命令不符 |

## Changelog from v4 (final consistency pass)

| # | Change | Reason |
| - | ------ | ------ |
| 16 | `WorkSession` 加 `namedGoalId?: string`，`createWorkSession(goal)` 透传；删除"WorkSession 不加字段"原表述 | `state-store` 只存 session，无 goal 查询面，不加字段则 `listSessions()` 无法构建带 `namedGoalId` 的 summary |
| 17 | dispatcher snippet 修正：`namedId` → `namedGoalId`；`resumeFrom: match.id` → `resumeFrom: { sessionId: match.id }` | 对齐 v4 已定义的 `createWorkGoal` 入参名和 engine opts 结构 |

---

## Phase 2 Theme

> Make the core reliable, replayable, and event-driven.

Phase 1 proved the core loop works. Phase 2 makes it trustworthy for unattended and recurring use.

**Iron rule (inherited)**: Nothing in Phase 2 redefines Phase 1 semantics. All additions wrap outward.

---

## Key Design Decisions

| Question | Decision | Rationale |
| -------- | --------- | --------- |
| Snapshot format | Versioned JSON with `schemaVersion` field | Event sourcing replay is fragile for restore; versioned JSON is durable |
| Snapshot responsibility | SessionPlane owns hydrate; state-store owns persistence | Architecture doc §8.2; EmbeddedRuntime private state must be reconstructed by the runtime itself |
| RUNBOOK.md template | Goal + ordered actions + verifications + limitations, derived from JSONL trace | Mechanical generation, no free-form editing required |
| Automation binding key | Named goal ID (`string` slug) in a central goals registry | Hashes break on description change; goal def must not be scattered across source configs |
| vibe profile UX | Passive event log only — no confirmation prompts | Max speed, full visibility via JSONL trace |
| platform policy source | Global `~/.octopus/policy.json` or explicit `--policy-file <path>` only | Workspace-local policy = self-authorization = security boundary violation |
| Automation scope | cron + watcher only in Phase 2 | webhook/poller/daemon belong to Phase 3 (networked) |

---

## Deliverables Overview

| # | Deliverable | Packages Affected | Priority |
| - | ----------- | ----------------- | -------- |
| 2.1 | State Snapshot + Restore | `agent-runtime` (update), `state-store` (update), `runtime-embedded` (update), `work-core` (update) | P0 |
| 2.2 | Verification Flow Hardening | `work-contracts` (update), `work-core` (update) | P0 |
| 2.3 | Planning Artifacts Formal Management | `work-core` (update) | P1 |
| 2.4 | Security: `vibe` + `platform` profiles | `security` (update) | P1 |
| 2.5 | Automation / Event Injection (cron + watcher) | `automation` (new) | P1 |
| 2.6 | Observability: new event types | `observability` (update) | P0 (do first) |
| 2.7 | CLI updates | `surfaces-cli` (update) | P2 |

**Build sequence**: 2.6 (observability) → 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.7

---

## 2.6 Observability: New Event Types (do first — gate for everything else)

Per architecture §11.5: every new core capability must declare its events before implementation.

**Package**: `observability/src/types.ts` — this is where P1 established `WorkEventType` and `EventPayloadByType`. New types extend those, NOT `work-contracts`. `work-contracts` owns domain types only.

```typescript
// packages/observability/src/types.ts — additions to WorkEventType

// Group A: Snapshot lifecycle
export type SnapshotEventType =
  | 'snapshot.captured'    // { sessionId, snapshotId, capturedAt, schemaVersion }
  | 'snapshot.restored';   // { sessionId, snapshotId, restoredAt }

// Group B: Workspace lock
export type WorkspaceLockEventType =
  | 'workspace.lock.acquired'   // { sessionId, pid }
  | 'workspace.lock.released';  // { sessionId, reason: 'completed'|'failed'|'cancelled'|'stale-cleared' }

// Group C: Verification plugin
export type VerificationPluginEventType =
  | 'verification.plugin.run';  // { method, status, score?, durationMs, evidenceCount }

// Group D: Artifact management
export type ArtifactManagementEventType =
  | 'runbook.generated';  // { sessionId, path, stepCount }

// Group E: Policy resolution (new in v3 — platform-loader must emit this)
export type PolicyEventType =
  | 'profile.selected'   // { profile, source: 'builtin'|'flag'|'global'|'default-deny' }
  | 'policy.resolved';   // { profile, policyFilePath?, allowedExecutables?, allowNetwork?, allowRemote?, defaultDeny: boolean }

// Group F: Automation lifecycle (new in v3)
export type AutomationEventType =
  | 'automation.source.started'   // { sourceType, namedGoalId }
  | 'automation.source.stopped'   // { sourceType, namedGoalId, reason? }
  | 'automation.source.failed'    // { sourceType, namedGoalId, error }
  | 'automation.triggered'        // { sourceType, namedGoalId, payload? }
  | 'event.injected';             // { namedGoalId, sessionId, action: 'skipped'|'resumed'|'created' }

// Updated WorkEventType union
export type WorkEventType =
  | SessionEventType | WorkItemEventType | CoreEventType | SubstrateEventType
  | SnapshotEventType | WorkspaceLockEventType | VerificationPluginEventType
  | ArtifactManagementEventType | PolicyEventType | AutomationEventType;
```

**Typed payloads** added to `EventPayloadByType` for all 9 new event types (2 groups added in v3). No `Record<string, unknown>` escape.

**Contract tests**: `packages/observability/src/__tests__/contract.test.ts` extended with assertions for all new event types.

**Files changed**: `packages/observability/src/types.ts` only.

---

## 2.1 State Snapshot + Restore

### Responsibility model (v2 — corrected from v1)

| Layer | Responsibility |
| ----- | -------------- |
| `agent-runtime` | Defines `SessionSnapshot` type (includes full runtimeContext); `SessionPlane` owns `hydrateSession()` |
| `runtime-embedded` | Implements `snapshotSession()` (captures private Maps) + `hydrateSession()` (reconstructs them) |
| `state-store` | Persistence only: write/read/list snapshot files on disk |
| `work-core` | Orchestrates: load snapshot (state-store) → hydrate (runtime) → continue loop |

### SessionSnapshot type (in `agent-runtime`)

```typescript
// packages/agent-runtime/src/types.ts (updated)

// RuntimeContext: captures only the runtime in-memory state that is NOT in WorkSession.
// NOTE: messages/conversation history is NOT included — HttpModelClient is a stateless
// turn executor (single-prompt, no multi-turn history). Adding a messages array would
// snapshot permanently-empty state and never affect model behavior.
// Multi-turn conversation history is a separate feature deferred to Phase 2+ or Phase 3.
export interface RuntimeContext {
  pendingResults: ActionResult[];      // results accumulated since last model turn
  contextPayload?: ContextPayload;     // last loaded workspace context
}

export interface SessionSnapshot {
  schemaVersion: 2;
  snapshotId: string;                  // uuid
  capturedAt: Date;
  session: WorkSession;                // full domain state
  runtimeContext: RuntimeContext;      // runtime in-memory state (no messages — stateless client)
}
```

### SessionPlane addition

```typescript
// packages/agent-runtime/src/types.ts
export interface SessionPlane {
  initSession(goal: WorkGoal): Promise<WorkSession>;
  pauseSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  snapshotSession(sessionId: string): Promise<SessionSnapshot>; // now returns full snapshot
  hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession>; // NEW
  getMetadata(sessionId: string): Promise<RuntimeMetadata>;
}
```

### EmbeddedRuntime implementation

```typescript
// packages/runtime-embedded/src/runtime.ts
// No new Maps needed — ModelClient is stateless; no conversation history to track.
// P1 already has: sessions Map, contexts Map, results Map. All three are captured/restored.

async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
  return {
    schemaVersion: 2,
    snapshotId: randomUUID(),
    capturedAt: new Date(),
    session: this.sessions.get(sessionId)!,
    runtimeContext: {
      pendingResults: this.results.get(sessionId) ?? [],
      contextPayload: this.contexts.get(sessionId),
    },
  };
}

async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
  if (snapshot.schemaVersion !== 2) {
    throw new Error(`Unsupported snapshot schema version: ${snapshot.schemaVersion}`);
  }
  const { session, runtimeContext } = snapshot;
  this.sessions.set(session.id, session);
  this.results.set(session.id, runtimeContext.pendingResults);
  if (runtimeContext.contextPayload) {
    this.contexts.set(session.id, runtimeContext.contextPayload);
  }
  return session;
}
```

### StateStore additions (persistence only)

```typescript
// packages/state-store/src/store.ts
export interface StateStore {
  // ... existing P1 methods ...
  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void>;
  loadSnapshot(sessionId: string, snapshotId?: string): Promise<SessionSnapshot | null>;
  listSnapshots(sessionId: string): Promise<SnapshotSummary[]>;
}

// Storage: .octopus/snapshots/<session-id>/<snapshot-id>.json
```

### WorkEngine.executeGoal orchestration

```typescript
// packages/work-core/src/engine.ts
async executeGoal(
  goal: WorkGoal,
  opts: { workspaceRoot?: string; resumeFrom?: string } = {}
): Promise<WorkSession> {
  if (opts.resumeFrom) {
    // 1. Load snapshot from state-store
    const snapshot = await this.stateStore.loadSnapshot(opts.resumeFrom);
    // 2. Hydrate runtime (reconstructs private Maps)
    const session = await this.runtime.hydrateSession(snapshot);
    // 3. Emit snapshot.restored event
    // 4. Continue loop from active state — skip Intake/Scope
    return this.runLoop(session, opts.workspaceRoot);
  }
  // Normal path: Intake → Scope → Loop
}
```

### Snapshot capture policy

Snapshots are captured automatically at these points in the work loop:

| Trigger | Who calls `snapshotSession()` | Notes |
| ------- | ----------------------------- | ----- |
| `pauseSession()` invoked | `WorkEngine` before delegating to runtime | Operator-initiated pause |
| Session transitions to `blocked` state | `WorkEngine` after `transitionSession("blocked")` | Model asked for clarification / policy blocked action |
| Automation handoff — **before** `dispatcher.dispatch()` calls `engine.executeGoal()` for a `resumed` action | `AutomationDispatcher` | Ensures a pre-handoff snapshot exists for rollback |

**Not** captured: after every action (too frequent / snapshot size), on `completed`/`failed`/`cancelled` (terminal — restore would restart, not resume).

### `restore --at` API closure

```typescript
// packages/work-core/src/engine.ts
async executeGoal(
  goal: WorkGoal,
  opts: {
    workspaceRoot?: string;
    // resumeFrom carries the resolved snapshotId — time-based resolution is CLI's job
    resumeFrom?: { sessionId: string; snapshotId?: string };
  } = {}
): Promise<WorkSession> {
  if (opts.resumeFrom) {
    const snapshot = await this.stateStore.loadSnapshot(
      opts.resumeFrom.sessionId,
      opts.resumeFrom.snapshotId   // undefined → latest
    );
    const session = await this.runtime.hydrateSession(snapshot);
    // emit snapshot.restored
    return this.runLoop(session, opts.workspaceRoot);
  }
  // Normal path
}
```

```typescript
// packages/surfaces-cli/src/commands/restore.ts
// CLI resolves --at <timestamp> → snapshotId before calling engine
const snapshots = await stateStore.listSnapshots(sessionId);
const target = opts.at
  ? snapshots
      .filter(s => s.capturedAt <= new Date(opts.at))
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0]
  : snapshots[0];  // latest
await engine.executeGoal(
  /* existing goal reconstructed from snapshot.session.goalId */,
  { resumeFrom: { sessionId, snapshotId: target.snapshotId } }
);
```

The engine never receives a raw timestamp — time-based selection is a query concern that belongs in the CLI layer.

**Files changed**:

- `packages/work-contracts/src/types.ts` — `WorkGoal.namedGoalId?`, `WorkSession.namedGoalId?`, `SessionSummary.namedGoalId?`
- `packages/work-contracts/src/factories.ts` — `CreateWorkGoalInput.namedGoalId?`, propagate to `createWorkSession()`
- `packages/agent-runtime/src/types.ts` — `SessionSnapshot`, `RuntimeContext` (no `RuntimeMessage`), `hydrateSession()`
- `packages/runtime-embedded/src/runtime.ts` — full `snapshotSession()` + `hydrateSession()` (no new Maps)
- `packages/state-store/src/types.ts` — `saveSnapshot`, `loadSnapshot`, `listSnapshots`, `SnapshotSummary`; `SessionSummary.namedGoalId?` propagation
- `packages/state-store/src/snapshot.ts` — new file, serialisation with Date handling
- `packages/work-core/src/engine.ts` — `resumeFrom: { sessionId, snapshotId? }`, capture at `blocked`/`pauseSession`, emit `snapshot.captured/restored`

**Tests**:

- `packages/agent-runtime/src/__tests__/snapshot.test.ts` — schema version check, round-trip type test
- `packages/runtime-embedded/src/__tests__/snapshot.test.ts` — hydrate reconstructs sessions + results + contexts Maps
- `packages/state-store/src/__tests__/snapshot.test.ts` — file I/O, latest vs specific snapshotId selection
- `packages/work-core/src/__tests__/resume.test.ts` — engine resumes without re-running Intake/Scope
- `packages/work-core/src/__tests__/capture-policy.test.ts` — snapshot captured on blocked, on pauseSession; NOT on completed

---

## 2.2 Verification Flow Hardening (`work-contracts`, `work-core`)

### Domain contract additions for automation (`work-contracts`)

```typescript
// packages/work-contracts/src/types.ts (additions only — existing fields unchanged)

// WorkGoal — add optional namedGoalId for automation stable binding
export interface WorkGoal {
  id: string;
  description: string;
  constraints: string[];
  successCriteria: string[];
  createdAt: Date;
  namedGoalId?: string;    // NEW: stable automation binding key (slug)
}

// SessionSummary — add namedGoalId for state-store query by automation dispatcher
export interface SessionSummary {
  id: string;
  goalId: string;
  state: SessionState;
  updatedAt: Date;
  namedGoalId?: string;    // NEW: propagated from WorkGoal on session create
}
```

```typescript
// packages/work-contracts/src/factories.ts (update)
export interface CreateWorkGoalInput {
  id?: string;
  description: string;
  constraints?: string[];
  successCriteria?: string[];
  createdAt?: Date;
  namedGoalId?: string;    // NEW: automation binding key
}
```

`WorkSession` also gets `namedGoalId?: string`, and `createWorkSession(goal)` transparently propagates `goal.namedGoalId`. This is the only way `state-store.listSessions()` can build `SessionSummary` with `namedGoalId` — `state-store` stores sessions, not goals, so it cannot do a goal lookup.

```typescript
// packages/work-contracts/src/types.ts
export interface WorkSession {
  id: string;
  goalId: string;
  namedGoalId?: string;   // NEW: propagated from WorkGoal.namedGoalId at createWorkSession()
  state: SessionState;
  // ... rest unchanged
}
```

**Files changed**: `packages/work-contracts/src/types.ts`, `packages/work-contracts/src/factories.ts`

---

### Updated Verification types

```typescript
// packages/work-contracts/src/types.ts (updates)
export type VerificationStatus = 'pass' | 'fail' | 'partial' | 'skipped';

export interface VerificationResult {
  id: string;
  method: VerificationMethod;
  status: VerificationStatus;
  score?: number;          // 0.0–1.0 for partial (e.g. 0.8 = 8/10 tests passed)
  evidence: EvidenceItem[];
  durationMs: number;
  createdAt: Date;
}

export type VerificationMethod =
  | 'test-runner'
  | 'diff-check'
  | 'schema-validator'
  | 'output-compare'
  | 'manual';

export interface EvidenceItem {
  label: string;   // e.g. "tests passed"
  value: string;   // e.g. "42/42"
  passed: boolean;
}
```

### Updated completion predicate

```typescript
// packages/work-contracts/src/completion.ts
export interface CompletionEvidence {
  targetArtifactExists: boolean;
  verificationPassed: boolean;        // at least one 'pass' status (not just any verification)
  noUnresolvedPartials: boolean;      // no 'partial' without explicit override
  limitationsPersisted: boolean;
  stateDurable: boolean;
  partialOverrideGranted?: boolean;   // explicit user/session override
}

export function isCompletable(e: CompletionEvidence): boolean {
  return (
    e.targetArtifactExists &&
    e.verificationPassed &&
    (e.noUnresolvedPartials || e.partialOverrideGranted === true) &&
    e.limitationsPersisted &&
    e.stateDurable
  );
}
```

### Verification plugins (Work Core)

```typescript
// packages/work-core/src/verification/plugin.ts
export interface VerificationPlugin {
  method: VerificationMethod;
  run(context: VerificationContext): Promise<VerificationResult>;
}

export interface VerificationContext {
  workspaceRoot: string;
  sessionId: string;
  workItemId: string;
  artifactPaths: string[];
}
```

Built-in Phase 2 plugins (4):

- `TestRunnerPlugin` — spawn test command, parse exit code + stdout for pass/fail counts
- `DiffCheckPlugin` — verify file changed (or unchanged) vs baseline
- `SchemaValidatorPlugin` — validate JSON output against a schema file
- `OutputComparePlugin` — compare file contents to expected fixture

Each plugin emits `verification.plugin.run` event.

**Files changed**:

- `packages/work-contracts/src/types.ts` — new verification types
- `packages/work-contracts/src/completion.ts` — updated predicate
- `packages/work-core/src/verification/plugin.ts` — interface
- `packages/work-core/src/verification/test-runner.ts`
- `packages/work-core/src/verification/diff-check.ts`
- `packages/work-core/src/verification/schema-validator.ts`
- `packages/work-core/src/verification/output-compare.ts`
- `packages/work-core/src/engine.ts` — enforce partial rule

**Tests**:

- `packages/work-contracts/src/__tests__/completion.test.ts` — partial blocks, override allows
- `packages/work-core/src/__tests__/verification/` — one test per plugin

---

## 2.3 Planning Artifacts Formal Management (`work-core`)

### Standard templates

```typescript
// packages/work-core/src/artifacts/templates.ts
export function renderPlan(session: WorkSession, goal: WorkGoal): string
export function renderTodo(items: WorkItem[]): string
export function renderStatus(session: WorkSession): string
export function renderRunbook(session: WorkSession, goal: WorkGoal, trace: WorkEvent[]): string
```

### RUNBOOK.md structure (generated from JSONL trace)

```markdown
# Runbook: <goal.description>

Generated: <timestamp>  Session: <session-id>

## Goal
<goal.description>
Constraints: <goal.constraints>

## Steps
### Step 1 — <workitem.description>
**Action**: `<executable> <args>` | read `<path>` | patch `<path>`
**Result**: <action.result summary>
**Verified**: <verification.status> (<score if partial>) — <evidence summary>

## Known Limitations
<from STATUS.md limitations section>

## Verification Summary
| Step | Method | Status | Score |
```

### Workspace lock

```typescript
// packages/work-core/src/workspace-lock.ts
export interface WorkspaceLock {
  acquire(workspaceRoot: string, sessionId: string): Promise<void>;
  release(workspaceRoot: string, sessionId: string, reason: ReleaseReason): Promise<void>;
  isHeld(workspaceRoot: string): Promise<boolean>;
  clearStale(workspaceRoot: string): Promise<boolean>; // true if stale was found+cleared
}
// Lock file: .octopus/workspace.lock — { sessionId, pid, acquiredAt }
// Stale: pid no longer running → auto-clear + emit workspace.lock.released(reason: 'stale-cleared')
```

**Files**:

- `packages/work-core/src/artifacts/templates.ts` (new)
- `packages/work-core/src/artifacts/runbook.ts` (new)
- `packages/work-core/src/workspace-lock.ts` (new)
- `packages/work-core/src/engine.ts` — acquire on active, release on terminal states, call renderRunbook on completion

**Tests**:

- `packages/work-core/src/__tests__/artifacts/templates.test.ts`
- `packages/work-core/src/__tests__/artifacts/runbook.test.ts`
- `packages/work-core/src/__tests__/workspace-lock.test.ts` — stale lock detection + auto-clear

---

## 2.4 Security: `vibe` + `platform` Profiles (`security`)

### `vibe` profile

```typescript
// packages/security/src/vibe.ts
export class VibePolicy implements SecurityPolicy {
  evaluate(_action: Action, _category: ActionCategory): PolicyDecision {
    return { allowed: true, requiresConfirmation: false, riskLevel: 'safe', reason: 'vibe profile' };
  }
  approveForSession(_pattern: string): void { /* no-op */ }
}
```

- All categories allowed, no confirmations
- `modelApiCall`: allowed if configured
- `network`: allowed (user accepts responsibility)
- `remote`: still disabled (gateway not yet available in Phase 2)
- All actions logged passively to JSONL + CLI

### `platform` profile (v2 — corrected trust model)

```typescript
// packages/security/src/platform.ts
export class PlatformPolicy implements SecurityPolicy {
  constructor(private readonly policyFile: PolicyFile) {}

  evaluate(action: Action, category: ActionCategory): PolicyDecision {
    // All decisions from policyFile — no interactive confirmation
    // Default-deny for shell/network/remote unless explicitly listed in policyFile
  }
}

export interface PolicyFile {
  schemaVersion: number;
  allowedExecutables?: string[];   // explicit allowlist; anything not here is denied
  allowNetwork?: boolean;          // default false
  allowRemote?: boolean;           // default false
}
```

**Policy file trust hierarchy** (resolved in this order, first found wins):

1. `--policy-file <absolute-path>` CLI flag — operator-controlled
2. `~/.octopus/policy.json` — user's global config
3. If neither exists: default-deny all shell/network/remote

**Workspace `.octopus/policy.json` is NOT a trusted source for `platform` profile.**
It is treated as read-only documentation only (the CLI `config` command may display it, but the engine never loads it as authoritative policy).

**platform-loader path validation (v3)**: Candidate paths must be resolved via `fs.realpathSync` before comparison. String prefix exclusion alone is insufficient (symlink bypass). Loader must:

```typescript
const resolvedCandidate = fs.realpathSync(candidatePath);
const resolvedWorkspace = fs.realpathSync(workspaceRoot);
if (resolvedCandidate.startsWith(resolvedWorkspace + path.sep)) {
  throw new Error(`Policy file inside workspace is not trusted for platform profile: ${candidatePath}`);
}
```

**policy.resolved event**: Emitted after every policy resolution attempt. Built-in profiles use `source: 'builtin'`; platform uses `flag`, `global`, or `default-deny`. Payload: `{ profile, source: 'builtin'|'flag'|'global'|'default-deny', policyFilePath?, allowedExecutables?, allowNetwork?, allowRemote?, defaultDeny: boolean }`. This makes "why was this action denied" answerable from the trace.

### Profile factory

```typescript
// packages/security/src/index.ts
export type SecurityProfileName = 'safe-local' | 'vibe' | 'platform';

export function createPolicy(
  profile: SecurityProfileName,
  opts: {
    confirmationUi?: ConfirmationUi;   // required for safe-local
    policyFilePath?: string;           // for platform: explicit path, else global
  }
): SecurityPolicy
```

**Files**:

- `packages/security/src/vibe.ts` (new)
- `packages/security/src/platform.ts` (new)
- `packages/security/src/platform-loader.ts` (new — resolves policy file from path hierarchy)
- `packages/security/src/index.ts` — factory + `SecurityProfileName`

**Tests**:

- `packages/security/src/__tests__/vibe.test.ts` — all categories allowed, no confirmation
- `packages/security/src/__tests__/platform.test.ts` — policy file respected; workspace policy ignored
- `packages/security/src/__tests__/platform-loader.test.ts` — path hierarchy resolution
- `packages/security/src/__tests__/profile-factory.test.ts`

---

## 2.5 Automation / Event Injection (`automation` — new package)

### Scope (Phase 2 only: cron + watcher)

| Source | Phase |
| ------ | ----- |
| cron | Phase 2 |
| watcher | Phase 2 |
| webhook | **Phase 3** (HTTP server = networked layer) |
| poller | **Phase 3** (external HTTP = networked layer) |
| automation daemon (start/stop/status) | **Phase 3** |

**Profile constraint**: Automation is incompatible with `safe-local` profile. `octopus automation run` must verify `profile ∈ {vibe, platform}` at startup and fail fast with a descriptive error if `safe-local` is detected. Reason: `safe-local` blocks on interactive terminal confirmation — unattended execution deadlocks immediately.

### Named Goal Registry (central source of truth)

Goal definitions live in `automation.json`, separate from sources. Sources only reference by ID.

```json
// .octopus/automation.json
{
  "goals": {
    "daily-report": {
      "description": "Generate daily operations report from logs",
      "constraints": ["Output to reports/daily/YYYY-MM-DD.md"],
      "successCriteria": ["Report file exists", "No parse errors in output"]
    },
    "normalize-incoming": {
      "description": "Normalize new files in incoming/ to standard format",
      "constraints": ["Source: incoming/", "Target: processed/"]
    }
  },
  "sources": [
    { "type": "cron",    "namedGoalId": "daily-report",      "schedule": "0 9 * * 1-5" },
    { "type": "watcher", "namedGoalId": "normalize-incoming", "watchPath": "./incoming", "events": ["add"] }
  ]
}
```

### Core types

```typescript
// packages/automation/src/types.ts
export interface NamedGoalDefinition {
  description: string;
  constraints?: string[];
  successCriteria?: string[];
}

export interface NamedGoalRegistry {
  [namedGoalId: string]: NamedGoalDefinition;
}

export interface AutomationEvent {
  sourceType: 'cron' | 'watcher';
  namedGoalId: string;
  triggeredAt: Date;
  payload?: Record<string, unknown>;
}

export interface AutomationSource {
  name: string;
  start(onEvent: (event: AutomationEvent) => void): Promise<void>;
  stop(): Promise<void>;
}
```

### Dispatcher (handoff rule engine)

```typescript
// packages/automation/src/dispatcher.ts
export class AutomationDispatcher {
  constructor(
    private stateStore: StateStore,
    private engine: WorkEngine,
    private goalRegistry: NamedGoalRegistry,
    private eventBus: EventBus,
  ) {}

  async dispatch(event: AutomationEvent): Promise<void> {
    const goalDef = this.goalRegistry[event.namedGoalId];
    if (!goalDef) {
      // Runtime missing key: emit failure event + log + skip (do NOT throw — one bad event must not kill the runner)
      // Note: loader.ts catches this at startup (fail fast) for static config errors.
      // This branch is a defensive fallback for dynamic injection edge cases.
      this.eventBus.emit({ type: 'automation.source.failed', payload: { sourceType: event.sourceType, namedGoalId: event.namedGoalId, error: `Unknown namedGoalId: ${event.namedGoalId}` } });
      return;
    }

    const sessions = await this.stateStore.listSessions();
    const match = sessions.find(s => s.namedGoalId === event.namedGoalId);

    if (match?.state === 'active') {
      // Queue event — do NOT create second writer
      this.eventBus.emit({ type: 'event.injected', payload: { action: 'skipped', ... } });
    } else if (match?.state === 'blocked' || match?.state === 'verifying') {
      // Resume paused/blocked session
      await this.engine.executeGoal(
        createWorkGoal({ ...goalDef, namedGoalId: event.namedGoalId }),
        { resumeFrom: { sessionId: match.id } }
      );
      this.eventBus.emit({ type: 'event.injected', payload: { action: 'resumed', ... } });
    } else {
      // No session — create new
      await this.engine.executeGoal(
        createWorkGoal({ ...goalDef, namedGoalId: event.namedGoalId })
      );
      this.eventBus.emit({ type: 'event.injected', payload: { action: 'created', ... } });
    }

    this.eventBus.emit({ type: 'automation.triggered', payload: { sourceType: event.sourceType, namedGoalId: event.namedGoalId } });
  }
}
```

### Cron source

```typescript
// packages/automation/src/sources/cron.ts — uses node-cron
export interface CronSourceConfig {
  namedGoalId: string;
  schedule: string;     // cron expression, e.g. "0 9 * * 1-5"
}
```

### Watcher source

```typescript
// packages/automation/src/sources/watcher.ts — uses chokidar
export interface WatcherSourceConfig {
  namedGoalId: string;
  watchPath: string;
  events: ('add' | 'change' | 'unlink')[];
  debounceMs?: number;  // default 500ms
}
```

**Package structure**:

```text
packages/automation/
  src/
    types.ts
    dispatcher.ts
    loader.ts          # loads + validates automation.json
    sources/
      cron.ts
      watcher.ts
    index.ts
```

Dependencies: `work-contracts`, `work-core`, `state-store`, `observability`
External: `node-cron`, `chokidar`
Build: tsc

**Tests**:

- `packages/automation/src/__tests__/dispatcher.test.ts` — all 3 handoff branches
- `packages/automation/src/__tests__/sources/cron.test.ts` — schedule fires, event emitted
- `packages/automation/src/__tests__/sources/watcher.test.ts` — file change triggers, debounce works
- `packages/automation/src/__tests__/loader.test.ts` — automation.json validation, unknown namedGoalId error

---

## 2.7 CLI Updates (`surfaces-cli`)

### New commands

```text
octopus restore <session-id>             # resume from latest snapshot
octopus restore <session-id> --at <ts>  # restore specific snapshot by timestamp
octopus run --profile vibe "..."        # select vibe profile
octopus run --profile platform "..."    # select platform profile (reads global policy)
octopus run --policy-file <path> "..."  # explicit policy file (platform profile implied)
```

### Updated `config` command (write support)

```text
octopus config set apiKey <value>
octopus config set model <value>
octopus config set profile <safe-local|vibe|platform>
```

### Automation bootstrap (Phase 2 — simple, no daemon)

In Phase 2, automation runs in-process with `octopus automation run`:

```text
octopus automation run    # load automation.json, start sources, block until Ctrl-C
```

No daemon management. Daemon (`start`/`stop`/`status`) is Phase 3.

**Profile constraint (v3)**: `octopus automation run` checks the active security profile at startup. If `safe-local` is detected, the command exits immediately with:

```text
Error: Automation requires 'vibe' or 'platform' profile.
       'safe-local' blocks on interactive confirmation — incompatible with unattended execution.
       Use: octopus automation run --profile vibe
```

This prevents the `safe-local` confirmation prompt from deadlocking the unattended runner.

**Files**:

- `packages/surfaces-cli/src/commands/restore.ts` (new)
- `packages/surfaces-cli/src/commands/automation.ts` (new)
- `packages/surfaces-cli/src/config-writer.ts` (new)
- `packages/surfaces-cli/src/cli.ts` — add restore, automation run, --profile flag, --policy-file flag

---

## Build Sequence

```text
Step 0: Update observability           — 9 new event types + typed payloads (SnapshotEventType,
                                         WorkspaceLockEventType, VerificationPluginEventType,
                                         ArtifactManagementEventType, PolicyEventType,
                                         AutomationEventType) in observability/src/types.ts  [tsc]
        Update work-contracts           — WorkGoal.namedGoalId?, SessionSummary.namedGoalId?,  [tsc]
                                         CreateWorkGoalInput.namedGoalId?,
                                         VerificationResult + VerificationMethod +
                                         CompletionEvidence update
Step 1: Update agent-runtime           — SessionSnapshot (full), RuntimeContext, hydrateSession() [tsc]
Step 2: Update state-store             — saveSnapshot, loadSnapshot, listSnapshots              [tsc]
Step 3: Update runtime-embedded        — full snapshotSession(), hydrateSession() (no new Maps) [tsup]
Step 4: Update work-core (engine)      — resumeFrom:{sessionId,snapshotId?}, capture policy,   [tsc]
                                         workspace lock, emit new events
Step 5: Update work-core (verification)— VerificationResult, 4 plugins, partial rule           [tsc]
Step 6: Update work-core (artifacts)   — templates, runbook generator                         [tsc]
Step 7: Update security                — vibe, platform (global policy only), factory          [tsc]
Step 8: New automation package         — dispatcher, NamedGoalRegistry, cron, watcher          [tsc]
Step 9: Update surfaces-cli            — restore, automation run, profile flag, config set     [tsup]
```

---

## Verification Commands

```bash
# Type check
pnpm -r type-check

# All tests
pnpm -r test

# Observability contract (gate — must pass before anything else merges)
pnpm --filter observability test -- --grep "contract"

# Snapshot round-trip
pnpm --filter runtime-embedded test -- --grep "snapshot"
pnpm --filter state-store test -- --grep "snapshot"

# Resume skips Intake/Scope
pnpm --filter work-core test -- --grep "resume"

# Partial verification blocks completion
pnpm --filter work-contracts test -- --grep "partial"

# platform ignores workspace policy
pnpm --filter security test -- --grep "platform"

# Automation dispatcher handoff rules (all 3 branches)
pnpm --filter automation test -- --grep "dispatcher"

# namedGoalId propagation: SessionSummary carries namedGoalId from WorkGoal
pnpm --filter work-contracts test -- --grep "namedGoalId"
pnpm --filter state-store test -- --grep "namedGoalId"

# Snapshot capture policy: captured on blocked/pause, NOT on completed
pnpm --filter work-core test -- --grep "capture-policy"

# Runbook generation
pnpm --filter work-core test -- --grep "runbook"

# Workspace lock stale detection
pnpm --filter work-core test -- --grep "workspace-lock"
```

---

## Risk Assessment

| Risk | Mitigation |
| ---- | ---------- |
| Snapshot schema breaks on work-contracts type change | `schemaVersion: 2` check on hydrate; unknown version throws descriptive error |
| No snapshot available when `restore` is called | Capture policy (blocked/pause/handoff) ensures snapshot exists before any resume point; `loadSnapshot` returns null → CLI error with hint to run first |
| platform loaded workspace policy despite new rule | `platform-loader.ts` explicit path hierarchy; workspace path hardcoded as excluded |
| Automation goal registry missing namedGoalId at dispatch time | Loader fails fast at startup for static config errors; dispatcher at runtime emits `automation.source.failed` + returns (no throw) |
| Watcher fires flood on bulk copy | debounceMs (default 500ms) collapses rapid events; handoff rule prevents parallel sessions |
| Stale workspace lock orphaned after crash | PID check on every acquire; stale auto-cleared with `workspace.lock.released(stale-cleared)` event |

---

## Explicit Exclusions (not in Phase 2)

- No gateway (Phase 3)
- No browser UI (Phase 3)
- No ACP runtime adapter (Phase 3)
- No webhook source (Phase 3)
- No poller source (Phase 3)
- No automation daemon/start/stop/status (Phase 3)
- No MCP (Phase 4)

---

## Status

- [x] Key questions answered (PHASE_PLAN.md)
- [x] v1 drafted
- [x] Codex Plan Review Round 1 — 5 findings
- [x] Plan updated to v2 (snapshot ownership, platform policy trust, goal registry, scope trim, observability)
- [x] Codex Plan Review Round 2 — 5 findings
- [x] Plan updated to v3 (observability ownership, safe-local deadlock rule, realpath validation, dispatcher emit+skip, source lifecycle + policy events)
- [x] Codex Plan Review Round 3 — 4 findings + 2 nits
- [x] Plan updated to v4 (namedGoalId domain contract, restore --at API closure, snapshot capture policy, remove messages Map/RuntimeMessage)
- [x] Plan updated to v5 (WorkSession.namedGoalId propagation, dispatcher snippet aligned to v4 interfaces)
- [x] Implementation: Step 0 — observability + work-contracts updates
- [x] Implementation: Step 1 — agent-runtime snapshot types
- [x] Implementation: Step 2 — state-store snapshot persistence
- [x] Implementation: Step 3 — runtime-embedded hydrate
- [x] Implementation: Step 4 — work-core engine (resume + lock)
- [x] Implementation: Step 5 — work-core verification hardening
- [x] Implementation: Step 6 — work-core artifacts + runbook
- [x] Implementation: Step 7 — security vibe + platform
- [x] Implementation: Step 8 — automation package
- [x] Implementation: Step 9 — surfaces-cli updates
- [x] Code Review
