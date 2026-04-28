# Agent Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Octopus agent runtime with action result terminality, failure taxonomy, context budgeting, progress events, and budget controls.

**Architecture:** Five targeted changes to existing packages — no new packages, no new directories. Types flow from work-contracts outward. Engine.ts is the primary modification target. All changes are backward-compatible via optional fields and default values.

**Tech Stack:** TypeScript, Vitest, Node.js. Monorepo packages: work-contracts, observability, agent-runtime, work-core, exec-substrate, runtime-embedded.

**Spec:** `docs/plans/2026-04-04-agent-runtime-hardening-design.md`

---

## File Structure

### Files Created
- `packages/work-core/src/errors.ts` — Typed error classes (ModelApiError, WorkspaceLockError)
- `packages/work-core/src/turn-context.ts` — TurnContext type + init/check/compact helpers
- `packages/work-core/src/__tests__/action-terminality.test.ts` — Tests for action result guarantees
- `packages/work-core/src/__tests__/failure-taxonomy.test.ts` — Tests for structured failure handling
- `packages/work-core/src/__tests__/turn-context.test.ts` — Tests for context budgeting
- `packages/work-core/src/__tests__/progress-events.test.ts` — Tests for progress reporting
- `packages/work-core/src/__tests__/budget-controls.test.ts` — Tests for budget enforcement
- `packages/exec-substrate/src/__tests__/progress.test.ts` — Tests for shell progress callback

### Files Modified
- `packages/work-contracts/src/types.ts` — Add ActionTerminalOutcome, extend ActionResult, add SessionUsage, BudgetLimits, budget-exceeded BlockedKind
- `packages/observability/src/types.ts` — Add action.progress event type + payload
- `packages/agent-runtime/src/types.ts` — Add TokenUsage, usage on ALL RuntimeResponse variants (not just action/completion)
- `packages/work-core/src/engine.ts` — Refactor runLoop, wrap executeAction with outcome mapping, budget checks (pre-turn AND post-response), progress wiring
- `packages/exec-substrate/src/types.ts` — Add onProgress to SubstrateContext, add timedOut flag to ActionResult
- `packages/exec-substrate/src/substrate.ts` — Wire onProgress in shell action, surface timedOut in result
- `packages/runtime-embedded/src/runtime.ts` — Add retry with backoff in requestNextAction, pass through token usage
- `packages/runtime-embedded/src/http-client.ts` — Return token usage from model responses
- `packages/surfaces-cli/src/cli.ts` — Add --max-cost, --max-tokens CLI flags
- `packages/gateway/src/routes/goals.ts` — Accept budget field in POST /api/goals

---

## Phase 1: Foundation — Action Result Terminality & Failure Taxonomy

### Task 1: Add ActionTerminalOutcome and extend ActionResult

**Files:**
- Modify: `packages/work-contracts/src/types.ts:23-46`
- Test: `packages/work-contracts/src/__tests__/constructors.test.ts`

- [ ] **Step 1: Add ActionTerminalOutcome type and extend ActionResult**

In `packages/work-contracts/src/types.ts`, after the `ActionType` definition (line 23) and before `WorkGoal` (line 25), add the new type. Then extend `ActionResult` (lines 34-38):

```ts
// After line 23 (ActionType), add:
export type ActionTerminalOutcome =
  | "completed"
  | "failed"
  | "denied"
  | "timed_out"
  | "cancelled"
  | "interrupted";

// Replace ActionResult (lines 34-38) with:
export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
  outcome?: ActionTerminalOutcome;
  durationMs?: number;
  timedOut?: boolean;  // Set by substrate shell action when timeout kills process
}
```

Note: `outcome` is optional (not required) for backward compatibility with existing serialized data. New code always sets it. The `timedOut` flag is set by the substrate shell executor so the engine can map it to the `timed_out` outcome (Codex review fix #1).

- [ ] **Step 2: Add budget-exceeded to BlockedKind**

In `packages/work-contracts/src/types.ts`, extend `BlockedKind` (lines 125-131):

```ts
export type BlockedKind =
  | "clarification-required"
  | "approval-required"
  | "verification-failed"
  | "paused-by-operator"
  | "budget-exceeded"
  | "system-error";
```

- [ ] **Step 3: Add SessionUsage and BudgetLimits**

In `packages/work-contracts/src/types.ts`, after the `BlockedReason` interface (line 145), add:

```ts
export interface SessionUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  wallClockMs: number;
  turnCount: number;
}

export interface BudgetLimits {
  maxTokens?: number;
  maxCostUsd?: number;
  maxWallClockMs?: number;
}
```

- [ ] **Step 4: Add usage to WorkSession**

In `packages/work-contracts/src/types.ts`, extend `WorkSession` (add before `blockedReason`):

```ts
export interface WorkSession {
  // ... existing fields ...
  usage?: SessionUsage;
  blockedReason?: BlockedReason;
}
```

- [ ] **Step 5: Run existing tests to verify no breakage**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-contracts`
Expected: All existing tests PASS (outcome is optional, so no breaking changes)

- [ ] **Step 6: Commit**

```bash
git add packages/work-contracts/src/types.ts
git commit -m "feat(work-contracts): add ActionTerminalOutcome, BudgetLimits, SessionUsage types"
```

---

### Task 2: Add typed error classes

**Files:**
- Create: `packages/work-core/src/errors.ts`

- [ ] **Step 1: Create error classes file**

Create `packages/work-core/src/errors.ts`:

```ts
export class ModelApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ModelApiError";
  }
}

export class WorkspaceLockError extends Error {
  constructor(
    message: string,
    public readonly holder?: string
  ) {
    super(message);
    this.name = "WorkspaceLockError";
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/work-core/src/errors.ts
git commit -m "feat(work-core): add ModelApiError and WorkspaceLockError typed errors"
```

---

### Task 3: Action result terminality — wrap executeAction with try/catch

**Files:**
- Test: `packages/work-core/src/__tests__/action-terminality.test.ts`
- Modify: `packages/work-core/src/engine.ts:274-344`

- [ ] **Step 1: Write failing test — action crash produces failed outcome**

Create `packages/work-core/src/__tests__/action-terminality.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AgentRuntime, ContextPayload, RuntimeResponse, SessionSnapshot } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import { EventBus } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import {
  createWorkGoal,
  createWorkSession,
  type Action,
  type ActionResult,
  type WorkGoal,
  type WorkSession
} from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";

describe("Action Result Terminality", () => {
  it("produces a failed outcome when substrate throws", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "boom", args: [] })
      },
      { kind: "completion", evidence: "done" }
    ]);
    const crashingSubstrate: ExecutionSubstratePort = {
      async execute() {
        throw new Error("Substrate exploded");
      }
    };
    const engine = new WorkEngine(
      runtime,
      crashingSubstrate,
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test crash" }));

    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("failed");
    expect(runtime.ingestedResults[0]?.success).toBe(false);
    expect(runtime.ingestedResults[0]?.error).toContain("Substrate exploded");
    // Session should continue to completion after ingesting the failure
    expect(session.state).not.toBe("failed");
  });

  it("produces a denied outcome and ingests result when policy denies", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "rm", args: ["-rf", "/"] })
      }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      denyAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test deny" }));

    expect(session.state).toBe("blocked");
    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("denied");
    expect(runtime.ingestedResults[0]?.error).toContain("Security policy denied");
  });

  it("produces timed_out outcome when substrate reports timeout", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("shell", { executable: "sleep", args: ["999"] })
      },
      { kind: "completion", evidence: "done" }
    ]);
    const timedOutSubstrate: ExecutionSubstratePort = {
      async execute() {
        return { success: false, output: "", error: "Timed out", timedOut: true };
      }
    };
    const engine = new WorkEngine(
      runtime,
      timedOutSubstrate,
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    await engine.executeGoal(createWorkGoal({ description: "Test timeout" }));

    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("timed_out");
  });

  it("sets completed outcome on successful execution", async () => {
    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: createAction("read", { path: "README.md" })
      },
      { kind: "completion", evidence: "done" }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "file contents" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    await engine.executeGoal(createWorkGoal({ description: "Test success" }));

    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("completed");
    expect(runtime.ingestedResults[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// --- Test helpers (duplicated per writing-plans requirements) ---

class FakeRuntime implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];

  constructor(private readonly responses: RuntimeResponse[]) {}

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    return createWorkSession(goal);
  }
  async pauseSession(): Promise<void> {}
  async resumeSession(): Promise<void> {}
  async cancelSession(): Promise<void> {}
  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return {
      schemaVersion: 2,
      snapshotId: `snap-${sessionId}`,
      capturedAt: new Date(),
      session: createWorkSession(createWorkGoal({ description: "snap" })),
      runtimeContext: { pendingResults: [] }
    };
  }
  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
    return snapshot.session;
  }
  async getMetadata() {
    return { runtimeType: "embedded" as const };
  }
  async loadContext(): Promise<void> {}
  async requestNextAction(): Promise<RuntimeResponse> {
    const r = this.responses.shift();
    if (!r) throw new Error("No more fake responses.");
    return r;
  }
  async ingestToolResult(_sid: string, _aid: string, result: ActionResult): Promise<void> {
    this.ingestedResults.push(result);
  }
  signalCompletion(): void {}
  signalBlocked(): void {}
}

class FakeSubstrate implements ExecutionSubstratePort {
  constructor(private readonly result: ActionResult) {}
  async execute(): Promise<ActionResult> {
    return this.result;
  }
}

class MemoryStateStore implements StateStore {
  readonly sessions: WorkSession[] = [];
  readonly saveHistory: WorkSession[] = [];
  async saveSession(session: WorkSession): Promise<void> {
    const clone = structuredClone(session);
    this.saveHistory.push(clone);
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) { this.sessions[idx] = clone; return; }
    this.sessions.push(clone);
  }
  async loadSession(): Promise<WorkSession | null> { return null; }
  async listSessions() { return []; }
  async saveSnapshot(): Promise<void> {}
  async loadSnapshot(): Promise<SessionSnapshot | null> { return null; }
  async listSnapshots() { return []; }
  async saveArtifact(): Promise<void> {}
  async loadArtifacts() { return []; }
}

function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return { id: `action-${type}`, type, params, createdAt: new Date() };
}

function allowAllPolicy(): SecurityPolicy {
  return {
    evaluate: () => ({ allowed: true, requiresConfirmation: false, riskLevel: "safe", reason: "Allowed." }),
    approveForSession() {}
  };
}

function denyAllPolicy(): SecurityPolicy {
  return {
    evaluate: () => ({ allowed: false, requiresConfirmation: false, riskLevel: "dangerous", reason: "Denied by policy." }),
    approveForSession() {}
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core/src/__tests__/action-terminality.test.ts`
Expected: FAIL — `outcome` is not set on ingested results, and denied actions don't call ingestToolResult

- [ ] **Step 3: Implement action result wrapping in engine.ts**

In `packages/work-core/src/engine.ts`, replace the `executeAction` method (lines 274-344). The key changes:
1. Wrap `substrate.execute()` in try/catch with timing
2. Always set `outcome` on results
3. Call `ingestToolResult` on security denial

```ts
  private async executeAction(
    session: WorkSession,
    item: WorkItem,
    action: Action,
    workspaceRoot?: string
  ): Promise<boolean> {
    this.emit(session, "action.requested", "work-core", { actionId: action.id, actionType: action.type });

    const decision = this.policy.evaluate(action, mapActionTypeToCategory(action.type));
    if (!decision.allowed) {
      const deniedResult: ActionResult = {
        success: false,
        output: "",
        error: `Security policy denied: ${decision.reason}`,
        outcome: "denied",
      };
      item.actions.push({ ...action, result: deniedResult });
      await this.runtime.ingestToolResult(session.id, action.id, deniedResult);
      this.emit(session, "action.completed", "work-core", { actionId: action.id, success: false });

      session.blockedReason = buildBlockedReason({
        actionId: action.id,
        reason: decision.reason,
        riskLevel: decision.riskLevel
      });
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
      const fingerprint = computeApprovalKey(action);
      session.blockedReason = {
        kind: "approval-required",
        approval: {
          actionId: action.id,
          actionType: action.type,
          fingerprint,
        },
        riskLevel: decision.riskLevel as RiskLevel,
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

    const startMs = Date.now();
    let result: ActionResult;
    try {
      const raw = await this.substrate.execute(action, {
        workspaceRoot: workspaceRoot ?? process.cwd(),
        sessionId: session.id,
        goalId: session.goalId,
        eventBus: this.eventBus
      });
      const outcome = raw.timedOut ? "timed_out" : "completed";
      result = { ...raw, outcome, durationMs: Date.now() - startMs };
    } catch (error) {
      result = {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : "Unknown execution error",
        outcome: "failed",
        durationMs: Date.now() - startMs,
      };
    }

    item.actions.push({ ...action, result });
    item.verifications.push(createVerification(action, result));
    item.state = "active";
    session.updatedAt = new Date();

    await this.runtime.ingestToolResult(session.id, action.id, result);
    await this.stateStore.saveSession(session);
    this.emit(session, "action.completed", "work-core", {
      actionId: action.id,
      success: result.success
    });
    return false;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core/src/__tests__/action-terminality.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all existing engine tests to verify no regression**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core`
Expected: All tests PASS. The "preserves riskLevel when policy denies" test may need updating since denied actions now call ingestToolResult.

- [ ] **Step 6: Fix any regression in existing tests**

If the "preserves riskLevel when policy denies" test (line 83) fails because `ingestedResults` is no longer empty, update the assertion to expect the denied result:

```ts
expect(runtime.ingestedResults).toHaveLength(1);
expect(runtime.ingestedResults[0]?.outcome).toBe("denied");
```

- [ ] **Step 7: Commit**

```bash
git add packages/work-core/src/__tests__/action-terminality.test.ts packages/work-core/src/engine.ts
git commit -m "feat(work-core): guarantee terminal outcome for every action execution"
```

---

### Task 4: Failure taxonomy — structured failure classification

**Files:**
- Create: `packages/work-core/src/__tests__/failure-taxonomy.test.ts`
- Modify: `packages/work-core/src/engine.ts:245-272`

- [ ] **Step 1: Write failing test — model API error is retried**

Create `packages/work-core/src/__tests__/failure-taxonomy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AgentRuntime, ContextPayload, RuntimeResponse, SessionSnapshot } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import { EventBus, type WorkEvent } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import {
  createWorkGoal,
  createWorkSession,
  type Action,
  type ActionResult,
  type WorkGoal,
  type WorkSession
} from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";

describe("Failure Taxonomy", () => {
  it("blocks session when runtime returns blocked after retryable errors", async () => {
    // Retry logic now lives in EmbeddedRuntime (Codex fix #2).
    // From the engine's perspective, exhausted retries arrive as {kind: "blocked"}.
    const runtime = new FakeRuntime([
      { kind: "blocked", reason: "Model request failed after retries." }
    ]);

    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test retry exhaustion" }));

    expect(session.state).toBe("blocked");
    expect(session.blockedReason?.kind).toBe("system-error");
  });

  it("blocks session when runtime returns blocked for non-retryable errors", async () => {
    const runtime = new FakeRuntime([
      { kind: "blocked", reason: "Model API call failed with status 401: Invalid API key" }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test non-retryable" }));

    expect(session.state).toBe("blocked");
  });

  it("continues loop after action crash with synthetic failed result", async () => {
    const runtime = new FakeRuntime([
      { kind: "action", action: createAction("shell", { executable: "crash", args: [] }) },
      { kind: "completion", evidence: "recovered" }
    ]);
    const crashingSubstrate: ExecutionSubstratePort = {
      async execute() {
        throw new Error("Process crashed");
      }
    };
    const engine = new WorkEngine(
      runtime,
      crashingSubstrate,
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test crash recovery" }));

    // After crash, loop should continue and hit the completion response
    expect(runtime.ingestedResults).toHaveLength(1);
    expect(runtime.ingestedResults[0]?.outcome).toBe("failed");
    // The completion response should succeed (headless mode without workspace)
    expect(session.state).not.toBe("failed");
  });
});

// --- Test helpers ---

class FailingRuntime implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];

  constructor(private readonly requestFn: () => Promise<RuntimeResponse>) {}

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    return createWorkSession(goal);
  }
  async pauseSession(): Promise<void> {}
  async resumeSession(): Promise<void> {}
  async cancelSession(): Promise<void> {}
  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return {
      schemaVersion: 2, snapshotId: `snap-${sessionId}`, capturedAt: new Date(),
      session: createWorkSession(createWorkGoal({ description: "snap" })),
      runtimeContext: { pendingResults: [] }
    };
  }
  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> { return snapshot.session; }
  async getMetadata() { return { runtimeType: "embedded" as const }; }
  async loadContext(): Promise<void> {}
  async requestNextAction(): Promise<RuntimeResponse> { return this.requestFn(); }
  async ingestToolResult(_s: string, _a: string, result: ActionResult): Promise<void> {
    this.ingestedResults.push(result);
  }
  signalCompletion(): void {}
  signalBlocked(): void {}
}

class FakeRuntime implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];
  constructor(private readonly responses: RuntimeResponse[]) {}
  async initSession(goal: WorkGoal): Promise<WorkSession> { return createWorkSession(goal); }
  async pauseSession(): Promise<void> {}
  async resumeSession(): Promise<void> {}
  async cancelSession(): Promise<void> {}
  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return {
      schemaVersion: 2, snapshotId: `snap-${sessionId}`, capturedAt: new Date(),
      session: createWorkSession(createWorkGoal({ description: "snap" })),
      runtimeContext: { pendingResults: [] }
    };
  }
  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> { return snapshot.session; }
  async getMetadata() { return { runtimeType: "embedded" as const }; }
  async loadContext(): Promise<void> {}
  async requestNextAction(): Promise<RuntimeResponse> {
    const r = this.responses.shift();
    if (!r) throw new Error("No more fake responses.");
    return r;
  }
  async ingestToolResult(_s: string, _a: string, result: ActionResult): Promise<void> {
    this.ingestedResults.push(result);
  }
  signalCompletion(): void {}
  signalBlocked(): void {}
}

class FakeSubstrate implements ExecutionSubstratePort {
  constructor(private readonly result: ActionResult) {}
  async execute(): Promise<ActionResult> { return this.result; }
}

class MemoryStateStore implements StateStore {
  readonly sessions: WorkSession[] = [];
  readonly saveHistory: WorkSession[] = [];
  async saveSession(session: WorkSession): Promise<void> {
    const clone = structuredClone(session);
    this.saveHistory.push(clone);
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) { this.sessions[idx] = clone; return; }
    this.sessions.push(clone);
  }
  async loadSession(): Promise<WorkSession | null> { return null; }
  async listSessions() { return []; }
  async saveSnapshot(): Promise<void> {}
  async loadSnapshot(): Promise<SessionSnapshot | null> { return null; }
  async listSnapshots() { return []; }
  async saveArtifact(): Promise<void> {}
  async loadArtifacts() { return []; }
}

function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return { id: `action-${type}`, type, params, createdAt: new Date() };
}

function allowAllPolicy(): SecurityPolicy {
  return {
    evaluate: () => ({ allowed: true, requiresConfirmation: false, riskLevel: "safe", reason: "Allowed." }),
    approveForSession() {}
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core/src/__tests__/failure-taxonomy.test.ts`
Expected: FAIL — ModelApiError is not imported, no retry logic exists

- [ ] **Step 3: Move retry into EmbeddedRuntime (Codex fix #2)**

**Why**: The current `EmbeddedRuntime.requestNextAction()` catches `ModelTurnError` and returns `{kind: "blocked"}`. The engine never sees a thrown error. Retry must live where the error is thrown — in the runtime, not the engine.

In `packages/runtime-embedded/src/runtime.ts`, replace `requestNextAction` (lines 145-173):

```ts
  async requestNextAction(sessionId: string): Promise<RuntimeResponse> {
    if (!this.config.allowModelApiCall) {
      throw new Error("Model API calls are disabled for this runtime.");
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const maxRetries = 3;
    let lastError: ModelTurnError | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const turn = await this.modelClient.completeTurn({
          session,
          context: this.contexts.get(sessionId),
          results: this.results.get(sessionId) ?? [],
          config: this.config
        });

        this.emitModelCall(sessionId, session.goalId, turn.telemetry);
        return turn.response;
      } catch (error) {
        const turnError = toModelTurnError(error, this.config);
        this.emitModelCall(sessionId, session.goalId, turnError.telemetry);

        // Retry on 429 (rate limit) and 5xx (server error)
        const status = turnError.telemetry.statusCode;
        if (status === 429 || (status !== undefined && status >= 500)) {
          lastError = turnError;
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          continue;
        }

        // Non-retryable: return blocked
        return { kind: "blocked", reason: turnError.message };
      }
    }

    // All retries exhausted
    return { kind: "blocked", reason: lastError?.message ?? "Model request failed after retries." };
  }
```

Then in `packages/work-core/src/engine.ts`, the `runLoop` stays simple — no `requestActionWithRetry`:

```ts
  private async runLoop(
    goal: WorkGoal,
    session: WorkSession,
    options: ExecuteGoalOptions,
    trace: WorkEvent[]
  ): Promise<WorkSession> {
    const maxIterations = options.maxIterations ?? 20;

    for (let index = 0; index < maxIterations; index += 1) {
      const response = await this.runtime.requestNextAction(session.id);

      if (response.kind === "action") {
        const currentItem = session.items.at(-1);
        if (!currentItem) {
          throw new Error("Work session has no active work item.");
        }

        const blocked = await this.executeAction(session, currentItem, response.action, options.workspaceRoot);
        if (blocked) {
          return session;
        }
        continue;
      }

      if (response.kind === "completion") {
        return this.completeSession(session, goal, response, options, trace);
      }

      if (response.kind === "blocked") {
        return this.blockSession(session, goal, response.reason, options.workspaceRoot, { reason: response.reason });
      }

      return this.blockSession(session, goal, response.question, options.workspaceRoot, {
        clarification: response.question
      });
    }

    return this.blockSession(session, goal, "Maximum iterations reached.", options.workspaceRoot, {
      reason: "Maximum iterations reached."
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core/src/__tests__/failure-taxonomy.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all work-core tests**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/work-core/src/__tests__/failure-taxonomy.test.ts packages/work-core/src/engine.ts
git commit -m "feat(work-core): add failure taxonomy with retry for retryable model API errors"
```

---

## Phase 2: Context Intelligence — TokenUsage & Turn Context

### Task 5: Add TokenUsage to RuntimeResponse

**Files:**
- Modify: `packages/agent-runtime/src/types.ts:43-47`

- [ ] **Step 1: Add TokenUsage interface and usage field to RuntimeResponse**

In `packages/agent-runtime/src/types.ts`, add before `RuntimeResponse`:

```ts
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
}
```

Update `RuntimeResponse` (lines 43-47):

```ts
export type RuntimeResponse =
  | { kind: "action"; action: Action; usage?: TokenUsage }
  | { kind: "completion"; evidence: string; usage?: TokenUsage }
  | { kind: "blocked"; reason: string; usage?: TokenUsage }
  | { kind: "clarification"; question: string; usage?: TokenUsage };
```

- [ ] **Step 2: Run agent-runtime tests**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/agent-runtime`
Expected: All PASS (usage is optional)

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/types.ts
git commit -m "feat(agent-runtime): add TokenUsage to RuntimeResponse"
```

---

### Task 6: Return token usage from runtime-embedded

**Files:**
- Modify: `packages/runtime-embedded/src/http-client.ts:46-48`
- Modify: `packages/runtime-embedded/src/runtime.ts:145-173`
- Test: `packages/runtime-embedded/src/__tests__/http-client.test.ts` (existing)

- [ ] **Step 1: Update HttpModelClient to include usage in RuntimeResponse**

In `packages/runtime-embedded/src/http-client.ts`, update the return in `completeTurn` (around line 46) to attach usage to the parsed response:

```ts
      const parsed = parseRuntimeResponse(text);

      // Attach token usage to the response if available
      const usage = telemetry.inputTokens !== undefined && telemetry.outputTokens !== undefined
        ? {
            inputTokens: telemetry.inputTokens,
            outputTokens: telemetry.outputTokens,
          }
        : undefined;

      if (usage && (parsed.kind === "action" || parsed.kind === "completion")) {
        (parsed as any).usage = usage;
      }

      return {
        response: parsed,
        telemetry
      };
```

- [ ] **Step 2: Run runtime-embedded tests**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/runtime-embedded`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/runtime-embedded/src/http-client.ts
git commit -m "feat(runtime-embedded): pass token usage through to RuntimeResponse"
```

---

### Task 7: Add TurnContext and context budgeting helpers

**Files:**
- Create: `packages/work-core/src/turn-context.ts`
- Test: `packages/work-core/src/__tests__/turn-context.test.ts`

- [ ] **Step 1: Write failing tests for turn-context helpers**

Create `packages/work-core/src/__tests__/turn-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { checkBudget, initTurnContext, truncateResult } from "../turn-context.js";

describe("TurnContext", () => {
  describe("initTurnContext", () => {
    it("initializes with defaults", () => {
      const ctx = initTurnContext({});
      expect(ctx.turnIndex).toBe(0);
      expect(ctx.maxIterations).toBe(20);
      expect(ctx.tokenBudgetUsed).toBe(0);
      expect(ctx.cumulativeCostUsd).toBe(0);
      expect(ctx.compactMarkers).toEqual([]);
    });

    it("respects provided options", () => {
      const ctx = initTurnContext({
        maxIterations: 10,
        budget: { maxTokens: 50000, maxCostUsd: 1.0 }
      });
      expect(ctx.maxIterations).toBe(10);
      expect(ctx.budget.maxTokens).toBe(50000);
      expect(ctx.budget.maxCostUsd).toBe(1.0);
    });
  });

  describe("truncateResult", () => {
    it("returns short outputs unchanged", () => {
      const result = truncateResult("short output");
      expect(result).toBe("short output");
    });

    it("truncates outputs exceeding 4096 chars", () => {
      const long = "x".repeat(5000);
      const result = truncateResult(long);
      expect(result.length).toBeLessThan(long.length);
      expect(result).toContain("[...truncated");
      expect(result.startsWith("x".repeat(100))).toBe(true);
      expect(result.endsWith("x".repeat(100))).toBe(true);
    });
  });

  describe("checkBudget", () => {
    it("returns null when within budget", () => {
      const ctx = initTurnContext({ budget: { maxTokens: 100000 } });
      ctx.tokenBudgetUsed = 50000;
      expect(checkBudget(ctx)).toBeNull();
    });

    it("returns failure when tokens exceeded", () => {
      const ctx = initTurnContext({ budget: { maxTokens: 100000 } });
      ctx.tokenBudgetUsed = 100001;
      const failure = checkBudget(ctx);
      expect(failure).not.toBeNull();
      expect(failure?.dimension).toBe("tokens");
    });

    it("returns failure when cost exceeded", () => {
      const ctx = initTurnContext({ budget: { maxCostUsd: 0.50 } });
      ctx.cumulativeCostUsd = 0.51;
      const failure = checkBudget(ctx);
      expect(failure).not.toBeNull();
      expect(failure?.dimension).toBe("cost");
    });

    it("returns failure when wall clock exceeded", () => {
      const ctx = initTurnContext({ budget: { maxWallClockMs: 1000 } });
      ctx.wallClockStartMs = Date.now() - 1500;
      const failure = checkBudget(ctx);
      expect(failure).not.toBeNull();
      expect(failure?.dimension).toBe("time");
    });

    it("returns null when no budget limits set", () => {
      const ctx = initTurnContext({});
      ctx.tokenBudgetUsed = 999999;
      expect(checkBudget(ctx)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core/src/__tests__/turn-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement turn-context.ts**

Create `packages/work-core/src/turn-context.ts`:

```ts
import type { BudgetLimits } from "@octopus/work-contracts";

export interface TurnContext {
  turnIndex: number;
  maxIterations: number;
  tokenBudgetUsed: number;
  tokenBudgetLimit: number;
  cumulativeCostUsd: number;
  wallClockStartMs: number;
  compactMarkers: number[];
  budget: BudgetLimits;
}

export interface BudgetFailure {
  dimension: "tokens" | "cost" | "time";
  current: number;
  limit: number;
  message: string;
}

const DEFAULT_TOKEN_BUDGET_LIMIT = 128_000;
const TRUNCATION_THRESHOLD = 4096;
const TRUNCATION_HEAD = 2048;
const TRUNCATION_TAIL = 1024;

export function initTurnContext(options: {
  maxIterations?: number;
  budget?: BudgetLimits;
}): TurnContext {
  return {
    turnIndex: 0,
    maxIterations: options.maxIterations ?? 20,
    tokenBudgetUsed: 0,
    tokenBudgetLimit: DEFAULT_TOKEN_BUDGET_LIMIT,
    cumulativeCostUsd: 0,
    wallClockStartMs: Date.now(),
    compactMarkers: [],
    budget: options.budget ?? {},
  };
}

export function truncateResult(output: string): string {
  if (output.length <= TRUNCATION_THRESHOLD) {
    return output;
  }
  const truncatedCount = output.length - TRUNCATION_HEAD - TRUNCATION_TAIL;
  return (
    output.slice(0, TRUNCATION_HEAD) +
    `\n[...truncated ${truncatedCount} characters...]\n` +
    output.slice(-TRUNCATION_TAIL)
  );
}

export function checkBudget(ctx: TurnContext): BudgetFailure | null {
  if (ctx.budget.maxTokens && ctx.tokenBudgetUsed >= ctx.budget.maxTokens) {
    return {
      dimension: "tokens",
      current: ctx.tokenBudgetUsed,
      limit: ctx.budget.maxTokens,
      message: `Token budget exceeded: ${ctx.tokenBudgetUsed} / ${ctx.budget.maxTokens}`,
    };
  }
  if (ctx.budget.maxCostUsd && ctx.cumulativeCostUsd >= ctx.budget.maxCostUsd) {
    return {
      dimension: "cost",
      current: ctx.cumulativeCostUsd,
      limit: ctx.budget.maxCostUsd,
      message: `Cost budget exceeded: $${ctx.cumulativeCostUsd.toFixed(4)} / $${ctx.budget.maxCostUsd.toFixed(2)}`,
    };
  }
  if (ctx.budget.maxWallClockMs) {
    const elapsed = Date.now() - ctx.wallClockStartMs;
    if (elapsed >= ctx.budget.maxWallClockMs) {
      return {
        dimension: "time",
        current: elapsed,
        limit: ctx.budget.maxWallClockMs,
        message: `Time budget exceeded: ${elapsed}ms / ${ctx.budget.maxWallClockMs}ms`,
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core/src/__tests__/turn-context.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/work-core/src/turn-context.ts packages/work-core/src/__tests__/turn-context.test.ts
git commit -m "feat(work-core): add TurnContext with budget checking and result truncation"
```

---

## Phase 3: Progress Events

### Task 8: Add action.progress event type

**Files:**
- Modify: `packages/observability/src/types.ts`
- Modify: `packages/exec-substrate/src/types.ts`

- [ ] **Step 1: Add action.progress event type to observability**

In `packages/observability/src/types.ts`, add to `CoreEventType` (line 24-31):

```ts
export type CoreEventType =
  | "context.loaded"
  | "decision.made"
  | "action.requested"
  | "action.completed"
  | "action.progress"
  | "verification.requested"
  | "verification.completed"
  | "artifact.emitted";
```

Add payload interface (after `ActionCompletedPayload`, around line 187):

```ts
export interface ActionProgressPayload {
  actionId: string;
  actionType: string;
  stream: "stdout" | "stderr" | "info";
  chunk: string;
  bytesTotal?: number;
}
```

Add to `EventPayloadByType` (after `action.completed` entry):

```ts
  "action.progress": ActionProgressPayload;
```

- [ ] **Step 2: Add onProgress to SubstrateContext**

In `packages/exec-substrate/src/types.ts`, extend `SubstrateContext`:

```ts
export interface SubstrateContext {
  workspaceRoot: string;
  sessionId: string;
  goalId: string;
  eventBus: EventBus;
  onProgress?: (stream: "stdout" | "stderr" | "info", chunk: string) => void;
}
```

- [ ] **Step 3: Run existing tests**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/observability packages/exec-substrate`
Expected: All PASS (additions are non-breaking)

- [ ] **Step 4: Commit**

```bash
git add packages/observability/src/types.ts packages/exec-substrate/src/types.ts
git commit -m "feat(observability): add action.progress event type and onProgress callback"
```

---

### Task 9: Wire progress callback in shell execution

**Files:**
- Test: `packages/exec-substrate/src/__tests__/progress.test.ts`
- Modify: `packages/exec-substrate/src/substrate.ts:124-178`

- [ ] **Step 1: Write failing test for shell progress**

Create `packages/exec-substrate/src/__tests__/progress.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import type { Action } from "@octopus/work-contracts";

import { ExecutionSubstrate } from "../substrate.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Shell Progress", () => {
  it("calls onProgress with stdout chunks during shell execution", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-progress-"));
    tempDirs.push(workspaceRoot);

    const chunks: Array<{ stream: string; chunk: string }> = [];
    const substrate = new ExecutionSubstrate();
    const action: Action = {
      id: "test-echo",
      type: "shell",
      params: { executable: "echo", args: ["hello world"] },
      createdAt: new Date()
    };

    await substrate.execute(action, {
      workspaceRoot,
      sessionId: "s1",
      goalId: "g1",
      eventBus: new EventBus(),
      onProgress: (stream, chunk) => {
        chunks.push({ stream, chunk });
      }
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.stream === "stdout" && c.chunk.includes("hello world"))).toBe(true);
  });

  it("does not crash when onProgress is not provided", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-progress-"));
    tempDirs.push(workspaceRoot);

    const substrate = new ExecutionSubstrate();
    const action: Action = {
      id: "test-echo",
      type: "shell",
      params: { executable: "echo", args: ["no callback"] },
      createdAt: new Date()
    };

    const result = await substrate.execute(action, {
      workspaceRoot,
      sessionId: "s1",
      goalId: "g1",
      eventBus: new EventBus()
    });

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/exec-substrate/src/__tests__/progress.test.ts`
Expected: FAIL — onProgress callback is never called

- [ ] **Step 3: Wire onProgress in executeShell and surface timedOut flag**

In `packages/exec-substrate/src/substrate.ts`, update `executeShell` (lines 124-178). Add progress piping to the stdout/stderr handlers and add `timedOut` to the return:

```ts
  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(chunk);
    if (context.onProgress) {
      context.onProgress("stdout", chunk.toString("utf8"));
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    if (context.onProgress) {
      context.onProgress("stderr", chunk.toString("utf8"));
    }
  });
```

Also update the return statement at the end of `executeShell` to include `timedOut`:

```ts
  return {
    success: exitCode === 0 && !timedOut,
    output,
    error: errorOutput || undefined,
    timedOut,  // NEW: surfaces timeout to engine for outcome mapping
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/exec-substrate/src/__tests__/progress.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Run all exec-substrate tests**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/exec-substrate`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/exec-substrate/src/substrate.ts packages/exec-substrate/src/__tests__/progress.test.ts
git commit -m "feat(exec-substrate): pipe shell stdout/stderr to onProgress callback"
```

---

### Task 10: Wire progress events through engine.ts

**Files:**
- Modify: `packages/work-core/src/engine.ts` (executeAction method)

- [ ] **Step 1: Pass onProgress callback to substrate.execute in engine.ts**

In the `executeAction` method, update the `substrate.execute()` call to include the progress callback:

```ts
      const raw = await this.substrate.execute(action, {
        workspaceRoot: workspaceRoot ?? process.cwd(),
        sessionId: session.id,
        goalId: session.goalId,
        eventBus: this.eventBus,
        onProgress: (stream, chunk) => {
          this.emit(session, "action.progress", "substrate", {
            actionId: action.id,
            actionType: action.type,
            stream,
            chunk,
          });
        },
      });
```

- [ ] **Step 2: Run all work-core tests**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/work-core/src/engine.ts
git commit -m "feat(work-core): emit action.progress events during substrate execution"
```

---

## Phase 4: Budget Controls

### Task 11: Integrate TurnContext and budget checking into engine.ts

**Files:**
- Test: `packages/work-core/src/__tests__/budget-controls.test.ts`
- Modify: `packages/work-core/src/engine.ts`

- [ ] **Step 1: Write failing test for budget enforcement**

Create `packages/work-core/src/__tests__/budget-controls.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AgentRuntime, ContextPayload, RuntimeResponse, SessionSnapshot, TokenUsage } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import { EventBus } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import {
  createWorkGoal,
  createWorkSession,
  type Action,
  type ActionResult,
  type WorkGoal,
  type WorkSession
} from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";

describe("Budget Controls", () => {
  it("blocks session when token budget is exceeded", async () => {
    const runtime = new FakeRuntimeWithUsage([
      { kind: "action", action: createAction("read", { path: "a.txt" }), usage: { inputTokens: 60000, outputTokens: 60000 } },
      { kind: "action", action: createAction("read", { path: "b.txt" }), usage: { inputTokens: 60000, outputTokens: 60000 } },
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(
      createWorkGoal({ description: "Test token budget" }),
      { budget: { maxTokens: 100000 } }
    );

    expect(session.state).toBe("blocked");
    expect(session.blockedReason?.kind).toBe("budget-exceeded");
  });

  it("accumulates usage across turns", async () => {
    const runtime = new FakeRuntimeWithUsage([
      { kind: "action", action: createAction("read", { path: "a.txt" }), usage: { inputTokens: 1000, outputTokens: 500 } },
      { kind: "action", action: createAction("read", { path: "b.txt" }), usage: { inputTokens: 1000, outputTokens: 500 } },
      { kind: "completion", evidence: "done", usage: { inputTokens: 1000, outputTokens: 200 } },
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Test usage tracking" }));

    expect(session.usage).toBeDefined();
    expect(session.usage?.totalInputTokens).toBe(3000);
    expect(session.usage?.totalOutputTokens).toBe(1200);
    expect(session.usage?.turnCount).toBe(3);
  });
});

// --- Test helpers ---

class FakeRuntimeWithUsage implements AgentRuntime {
  readonly type = "embedded" as const;
  readonly ingestedResults: ActionResult[] = [];
  constructor(private readonly responses: Array<RuntimeResponse & { usage?: TokenUsage }>) {}
  async initSession(goal: WorkGoal): Promise<WorkSession> { return createWorkSession(goal); }
  async pauseSession(): Promise<void> {}
  async resumeSession(): Promise<void> {}
  async cancelSession(): Promise<void> {}
  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return {
      schemaVersion: 2, snapshotId: `snap-${sessionId}`, capturedAt: new Date(),
      session: createWorkSession(createWorkGoal({ description: "snap" })),
      runtimeContext: { pendingResults: [] }
    };
  }
  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> { return snapshot.session; }
  async getMetadata() { return { runtimeType: "embedded" as const }; }
  async loadContext(): Promise<void> {}
  async requestNextAction(): Promise<RuntimeResponse> {
    const r = this.responses.shift();
    if (!r) throw new Error("No more fake responses.");
    return r;
  }
  async ingestToolResult(_s: string, _a: string, result: ActionResult): Promise<void> {
    this.ingestedResults.push(result);
  }
  signalCompletion(): void {}
  signalBlocked(): void {}
}

class FakeSubstrate implements ExecutionSubstratePort {
  constructor(private readonly result: ActionResult) {}
  async execute(): Promise<ActionResult> { return this.result; }
}

class MemoryStateStore implements StateStore {
  readonly sessions: WorkSession[] = [];
  readonly saveHistory: WorkSession[] = [];
  async saveSession(session: WorkSession): Promise<void> {
    const clone = structuredClone(session);
    this.saveHistory.push(clone);
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) { this.sessions[idx] = clone; return; }
    this.sessions.push(clone);
  }
  async loadSession(): Promise<WorkSession | null> { return null; }
  async listSessions() { return []; }
  async saveSnapshot(): Promise<void> {}
  async loadSnapshot(): Promise<SessionSnapshot | null> { return null; }
  async listSnapshots() { return []; }
  async saveArtifact(): Promise<void> {}
  async loadArtifacts() { return []; }
}

function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return { id: `action-${type}-${Math.random().toString(36).slice(2, 6)}`, type, params, createdAt: new Date() };
}

function allowAllPolicy(): SecurityPolicy {
  return {
    evaluate: () => ({ allowed: true, requiresConfirmation: false, riskLevel: "safe", reason: "Allowed." }),
    approveForSession() {}
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core/src/__tests__/budget-controls.test.ts`
Expected: FAIL — budget option doesn't exist on ExecuteGoalOptions, no usage tracking

- [ ] **Step 3: Integrate TurnContext and budget into engine.ts**

In `packages/work-core/src/engine.ts`:

1. Add imports:
```ts
import type { BudgetLimits, SessionUsage } from "@octopus/work-contracts";
import { checkBudget, initTurnContext, type TurnContext } from "./turn-context.js";
```

2. Extend `ExecuteGoalOptions`:
```ts
export interface ExecuteGoalOptions {
  workspaceRoot?: string;
  workspaceId?: string;
  configProfileId?: string;
  createdBy?: string;
  taskTitle?: string;
  maxIterations?: number;
  resumeFrom?: { sessionId: string; snapshotId?: string };
  partialOverrideGranted?: boolean;
  budget?: BudgetLimits;
}
```

3. Update `runLoop` to use TurnContext with budget checking and usage accumulation:

```ts
  private async runLoop(
    goal: WorkGoal,
    session: WorkSession,
    options: ExecuteGoalOptions,
    trace: WorkEvent[]
  ): Promise<WorkSession> {
    const turn = initTurnContext({
      maxIterations: options.maxIterations,
      budget: options.budget,
    });

    while (turn.turnIndex < turn.maxIterations) {
      // Budget check before each turn
      const budgetViolation = checkBudget(turn);
      if (budgetViolation) {
        session.blockedReason = {
          kind: "budget-exceeded",
          evidence: budgetViolation.message,
        };
        this.syncUsage(session, turn);
        transitionSession(session, "blocked", budgetViolation.message);
        await this.stateStore.saveSession(session);
        this.emit(session, "session.blocked", "work-core", { reason: budgetViolation.message });
        await this.captureSnapshot(session);
        return session;
      }

      const response = await this.runtime.requestNextAction(session.id);

      // Accumulate usage from ALL response kinds (Codex fix #4)
      if ("usage" in response && response.usage) {
        turn.inputTokensUsed += response.usage.inputTokens;
        turn.outputTokensUsed += response.usage.outputTokens;
        turn.tokenBudgetUsed += response.usage.inputTokens + response.usage.outputTokens;
        turn.cumulativeCostUsd += response.usage.estimatedCostUsd ?? 0;
      }

      // Post-response budget check (Codex fix #5)
      const postBudgetViolation = checkBudget(turn);
      if (postBudgetViolation) {
        session.blockedReason = { kind: "budget-exceeded", evidence: postBudgetViolation.message };
        this.syncUsage(session, turn);
        transitionSession(session, "blocked", postBudgetViolation.message);
        await this.stateStore.saveSession(session);
        this.emit(session, "session.blocked", "work-core", { reason: postBudgetViolation.message });
        await this.captureSnapshot(session);
        return session;
      }

      if (response.kind === "action") {
        const currentItem = session.items.at(-1);
        if (!currentItem) {
          throw new Error("Work session has no active work item.");
        }
        const blocked = await this.executeAction(session, currentItem, response.action, options.workspaceRoot);
        if (blocked) {
          this.syncUsage(session, turn);
          return session;
        }
        turn.turnIndex++;
        continue;
      }

      this.syncUsage(session, turn);

      if (response.kind === "completion") {
        return this.completeSession(session, goal, response, options, trace);
      }

      if (response.kind === "blocked") {
        return this.blockSession(session, goal, response.reason, options.workspaceRoot, { reason: response.reason });
      }

      return this.blockSession(session, goal, response.question, options.workspaceRoot, {
        clarification: response.question
      });
    }

    this.syncUsage(session, turn);
    return this.blockSession(session, goal, "Maximum iterations reached.", options.workspaceRoot, {
      reason: "Maximum iterations reached."
    });
  }

  private syncUsage(session: WorkSession, turn: TurnContext): void {
    session.usage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: turn.cumulativeCostUsd,
      wallClockMs: Date.now() - turn.wallClockStartMs,
      turnCount: turn.turnIndex + 1,
    };
    // Split accumulated tokens (approximate split, actual tracked per-response)
    const totalTokens = turn.tokenBudgetUsed;
    session.usage.totalInputTokens = Math.round(totalTokens * 0.7);
    session.usage.totalOutputTokens = totalTokens - session.usage.totalInputTokens;
  }
```

Wait — that split is wrong. We should track input/output separately. Let me fix the TurnContext to track them separately.

4. Update `turn-context.ts` to track input and output tokens separately:

Add fields to TurnContext:
```ts
export interface TurnContext {
  turnIndex: number;
  maxIterations: number;
  tokenBudgetUsed: number;         // total (input + output)
  inputTokensUsed: number;         // input only
  outputTokensUsed: number;        // output only
  tokenBudgetLimit: number;
  cumulativeCostUsd: number;
  wallClockStartMs: number;
  compactMarkers: number[];
  budget: BudgetLimits;
}
```

Update `initTurnContext` to initialize the new fields:
```ts
    inputTokensUsed: 0,
    outputTokensUsed: 0,
```

Then in engine.ts, the usage accumulation becomes:
```ts
      if ("usage" in response && response.usage) {
        turn.inputTokensUsed += response.usage.inputTokens;
        turn.outputTokensUsed += response.usage.outputTokens;
        turn.tokenBudgetUsed += response.usage.inputTokens + response.usage.outputTokens;
        turn.cumulativeCostUsd += response.usage.estimatedCostUsd ?? 0;
      }
```

And `syncUsage` becomes:
```ts
  private syncUsage(session: WorkSession, turn: TurnContext): void {
    session.usage = {
      totalInputTokens: turn.inputTokensUsed,
      totalOutputTokens: turn.outputTokensUsed,
      estimatedCostUsd: turn.cumulativeCostUsd,
      wallClockMs: Date.now() - turn.wallClockStartMs,
      turnCount: turn.turnIndex + 1,
    };
  }
```

- [ ] **Step 4: Update turn-context.ts with inputTokensUsed/outputTokensUsed**

Add to the `TurnContext` interface in `packages/work-core/src/turn-context.ts`:

```ts
export interface TurnContext {
  turnIndex: number;
  maxIterations: number;
  tokenBudgetUsed: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  tokenBudgetLimit: number;
  cumulativeCostUsd: number;
  wallClockStartMs: number;
  compactMarkers: number[];
  budget: BudgetLimits;
}
```

Update `initTurnContext`:

```ts
export function initTurnContext(options: {
  maxIterations?: number;
  budget?: BudgetLimits;
}): TurnContext {
  return {
    turnIndex: 0,
    maxIterations: options.maxIterations ?? 20,
    tokenBudgetUsed: 0,
    inputTokensUsed: 0,
    outputTokensUsed: 0,
    tokenBudgetLimit: DEFAULT_TOKEN_BUDGET_LIMIT,
    cumulativeCostUsd: 0,
    wallClockStartMs: Date.now(),
    compactMarkers: [],
    budget: options.budget ?? {},
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/work-core`
Expected: All PASS including budget-controls tests

- [ ] **Step 6: Commit**

```bash
git add packages/work-core/src/engine.ts packages/work-core/src/turn-context.ts packages/work-core/src/__tests__/budget-controls.test.ts packages/work-core/src/__tests__/turn-context.test.ts
git commit -m "feat(work-core): integrate TurnContext with budget enforcement and usage tracking"
```

---

### Task 12: Final integration test — run full test suite

**Files:**
- No new files

- [ ] **Step 1: Run the complete monorepo test suite**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run`
Expected: All tests PASS across all packages

- [ ] **Step 2: Fix any failures found**

If any tests fail due to the new optional fields or type changes, fix them. Common issues:
- Tests that do exact equality on `ActionResult` objects may need updating for `outcome`/`durationMs`
- Tests that check `ingestedResults.length === 0` after policy denial need updating to expect 1

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "test: fix integration issues from runtime hardening changes"
```

---

### Task 13: Wire budget options through CLI and gateway (Codex fix #7)

**Files:**
- Modify: `packages/surfaces-cli/src/cli.ts`
- Modify: `packages/gateway/src/routes/goals.ts`

- [ ] **Step 1: Add budget CLI flags**

In `packages/surfaces-cli/src/cli.ts`, find the `run` command options and add:

```ts
.option("--max-tokens <number>", "Maximum total tokens (input+output) per session")
.option("--max-cost <number>", "Maximum estimated cost in USD per session")
.option("--max-time <number>", "Maximum wall-clock time in milliseconds per session")
```

Wire these into `ExecuteGoalOptions.budget`:

```ts
const budget: BudgetLimits = {};
if (options.maxTokens) budget.maxTokens = Number(options.maxTokens);
if (options.maxCost) budget.maxCostUsd = Number(options.maxCost);
if (options.maxTime) budget.maxWallClockMs = Number(options.maxTime);

const executeOptions: ExecuteGoalOptions = {
  // ... existing options ...
  budget: Object.keys(budget).length > 0 ? budget : undefined,
};
```

- [ ] **Step 2: Add budget to POST /api/goals**

In `packages/gateway/src/routes/goals.ts`, extend the request body parsing to accept an optional `budget` field:

```ts
const budget = body.budget as BudgetLimits | undefined;

const options: ExecuteGoalOptions = {
  // ... existing options ...
  budget,
};
```

- [ ] **Step 3: Run CLI and gateway tests**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/surfaces-cli packages/gateway`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/surfaces-cli/src/cli.ts packages/gateway/src/routes/goals.ts
git commit -m "feat(surfaces): wire budget options through CLI flags and gateway API"
```

---

### Task 14: Add retry test for EmbeddedRuntime (Codex fix #2 verification)

**Files:**
- Test: `packages/runtime-embedded/src/__tests__/runtime.test.ts` (add to existing)

- [ ] **Step 1: Write test for retry in EmbeddedRuntime**

Add to the existing test file `packages/runtime-embedded/src/__tests__/runtime.test.ts`:

```ts
describe("requestNextAction retry", () => {
  it("retries on 429 and returns blocked after exhaustion", async () => {
    let callCount = 0;
    const failingClient: ModelClient = {
      async completeTurn() {
        callCount++;
        throw new ModelTurnError("Rate limited", {
          endpoint: "http://test",
          durationMs: 100,
          success: false,
          error: "Rate limited",
          statusCode: 429,
        });
      }
    };

    const runtime = new EmbeddedRuntime(
      { ...testConfig, allowModelApiCall: true },
      failingClient,
      new EventBus()
    );
    const goal = createWorkGoal({ description: "retry test" });
    await runtime.initSession(goal);
    const session = (runtime as any).sessions.values().next().value;

    const response = await runtime.requestNextAction(session.id);

    expect(callCount).toBe(3);
    expect(response.kind).toBe("blocked");
    expect(response.reason).toContain("Rate limited");
  });

  it("does not retry on 401", async () => {
    let callCount = 0;
    const failingClient: ModelClient = {
      async completeTurn() {
        callCount++;
        throw new ModelTurnError("Unauthorized", {
          endpoint: "http://test",
          durationMs: 50,
          success: false,
          error: "Unauthorized",
          statusCode: 401,
        });
      }
    };

    const runtime = new EmbeddedRuntime(
      { ...testConfig, allowModelApiCall: true },
      failingClient,
      new EventBus()
    );
    const goal = createWorkGoal({ description: "no retry test" });
    await runtime.initSession(goal);
    const session = (runtime as any).sessions.values().next().value;

    const response = await runtime.requestNextAction(session.id);

    expect(callCount).toBe(1);
    expect(response.kind).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd "/Users/apple/Documents/2.1 AI Journey/Cursor_projects/octopus" && npx vitest run packages/runtime-embedded`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/runtime-embedded/src/__tests__/runtime.test.ts
git commit -m "test(runtime-embedded): verify retry behavior for retryable model errors"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Every `action.requested` event has a matching `action.completed` event in traces
- [ ] Policy denial produces a `denied` outcome and calls `ingestToolResult`
- [ ] Substrate crash produces a `failed` outcome and continues the loop
- [ ] Shell timeout maps to `timed_out` outcome (Codex missing test #1)
- [ ] Retryable model API errors (429, 5xx) are retried up to 3 times in EmbeddedRuntime
- [ ] Non-retryable errors (401, 400) return blocked immediately without retry
- [ ] Token budget limit blocks the session with `budget-exceeded` — both pre-turn and post-response
- [ ] `blocked`/`clarification` responses still accumulate token usage (Codex missing test #2)
- [ ] Shell commands emit `action.progress` events via the EventBus
- [ ] Progress events appear in JSONL traces (not ephemeral — Codex fix #3)
- [ ] `session.usage` is populated on completed/blocked sessions
- [ ] TurnContext is NOT stored in RuntimeContext/snapshots (Codex fix #6)
- [ ] CLI `--max-cost` and `--max-tokens` flags work end-to-end
- [ ] `POST /api/goals` accepts `budget` field
- [ ] All existing tests pass without modification (or with minimal backward-compat fixes)
