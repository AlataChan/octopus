# Agent Runtime Hardening Design Spec

> Date: 2026-04-04
> Status: Approved
> Origin: Deep analysis of Claude Code v2.1.88 Agent Runtime reference docs (docs/reference/06-14)
> Reviewed by: Codex (Correctness 8/10, Simplicity 6/10, Safety 7/10, Consistency 8/10)

## Executive Summary

This spec defines 5 targeted improvements to Octopus's agent runtime, derived from analyzing Claude Code's Agent Runtime architecture and filtered for what actually matters at Octopus's current stage. The guiding principle from Codex's review: **copy the invariants, not the whole architecture.**

All changes fit within existing package boundaries. No new packages. No new directories.

## Background

### Reference Material

9 reverse-engineering documents of Claude Code v2.1.88 (in `docs/reference/06-14`) describe a 7-layer agent runtime with key design principles:

1. Session coordinator separated from turn machine
2. Unified Tool abstraction with schema/permission/concurrency semantics
3. Comprehensive failure semantics — every tool_use must have a paired result
4. Context windowing: auto-compact, token budget, memory prefetch
5. MCP tools wrapped into the same abstraction as built-in tools

### What Octopus Already Does Well

These are strengths to preserve, not replace:

- **Snapshot-based resumption** — better than transcript-based for durable work agent
- **Artifact-first completion predicate** — not just "model said done"
- **Security profiles** with policy evaluation + approval fingerprinting
- **Rich event taxonomy** (43 event types, JSONL trace)
- **One Runtime Protocol** (AgentRuntime = SessionPlane + ExecutionPlane), many adapters
- **Clean domain-type separation** (work-contracts -> work-core -> runtime adapters)

### What We're NOT Adopting

| Claude Code Pattern | Why Skip |
|---|---|
| Raw stream event processing | OpenAI-compatible API handles this differently |
| Transcript-based resume | Snapshot approach is better for durable work |
| StreamingToolExecutor | Single-action-per-turn model doesn't need it |
| Permission race (hook vs SDK) | Security profiles are sufficient for single-tenant |
| StructuredIO protocol | AgentRuntime + EventBus already serves this role |
| Full Tool Registry rewrite | Keep stable Action contract, add metadata incrementally |
| Action concurrency | Requires protocol change (batch actions); defer until needed |
| Mutation hooks | Risk to determinism; only observer hooks if needed later |

---

## Change 1: Action Result Terminality

### Problem

`executeAction()` in `engine.ts:274` emits `action.requested` but if `substrate.execute()` crashes or the process dies, there is no terminal result. The model loses context on resume, and traces have orphaned `action.requested` events without corresponding `action.completed` events.

### The Invariant

**Every requested action MUST produce exactly one terminal result.** This is the single most important reliability property of an agent runtime, per both the reference docs and Codex's review.

### Design

#### New type in `work-contracts/src/types.ts`

```ts
export type ActionTerminalOutcome =
  | "completed"     // Normal execution finished (success or error in output)
  | "failed"        // Execution threw an unexpected exception
  | "denied"        // Security policy blocked execution
  | "timed_out"     // Shell/MCP exceeded timeout limit
  | "cancelled"     // User interrupt or session pause
  | "interrupted";  // Process crash — synthesized on resume
```

#### Extended `ActionResult` in `work-contracts/src/types.ts`

```ts
export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
  outcome: ActionTerminalOutcome;  // NEW: always present
  durationMs?: number;             // NEW: wall-clock execution time
}
```

#### Changes to `engine.ts` `executeAction()`

Current code (line 322-327):
```ts
const result = await this.substrate.execute(action, { ... });
```

New code wraps in try/catch with timing:
```ts
const startMs = Date.now();
let result: ActionResult;
try {
  const raw = await this.substrate.execute(action, { ... });
  result = { ...raw, outcome: "completed", durationMs: Date.now() - startMs };
} catch (error) {
  result = {
    success: false,
    output: "",
    error: error instanceof Error ? error.message : "Unknown execution error",
    outcome: "failed",
    durationMs: Date.now() - startMs,
  };
}
```

#### Security denial also produces a result for the model

Current code blocks the session but never calls `ingestToolResult()`, so the model has no record of what happened. New behavior:

```ts
if (!decision.allowed) {
  const deniedResult: ActionResult = {
    success: false,
    output: "",
    error: `Security policy denied: ${decision.reason}`,
    outcome: "denied",
  };
  await this.runtime.ingestToolResult(session.id, action.id, deniedResult);
  // ... then block session as before
}
```

#### Resume synthesizes missing results

In `restoreSession()`, after hydrating from snapshot, scan the last work item's actions for any without a result:

```ts
const lastItem = session.items.at(-1);
if (lastItem) {
  for (const action of lastItem.actions) {
    if (!action.result) {
      action.result = {
        success: false,
        output: "",
        error: "Action was interrupted by process termination",
        outcome: "interrupted",
      };
      await this.runtime.ingestToolResult(session.id, action.id, action.result);
    }
  }
}
```

### Verification

- Unit test: action crash produces `{outcome: "failed"}` result
- Unit test: policy denial produces `{outcome: "denied"}` result and calls `ingestToolResult`
- Unit test: resume from snapshot with orphaned action synthesizes `{outcome: "interrupted"}`
- Integration test: trace has paired `action.requested` / `action.completed` for every action

---

## Change 2: Failure Taxonomy

### Problem

The `catch` in `runPreparedSession()` (line 260) catches everything as generic "Work engine failed" without distinguishing failure types or recovery paths. There's no structured way to know if a failure is retryable, what caused it, or what the system should do about it.

### Design

#### New type in `work-core` (internal, not in contracts)

```ts
type EngineFailure =
  | { kind: "model_api_error"; statusCode?: number; retryable: boolean; message: string }
  | { kind: "action_crash"; actionId: string; error: string }
  | { kind: "workspace_lock_conflict"; holder?: string }
  | { kind: "snapshot_corruption"; sessionId: string }
  | { kind: "budget_exceeded"; dimension: BudgetDimension; current: number; limit: number }
  | { kind: "context_overflow"; estimatedTokens: number; limit: number };

type BudgetDimension = "iterations" | "tokens" | "cost" | "time";
```

#### Recovery table

| Failure Kind | Detection Point | Recovery Action |
|---|---|---|
| `model_api_error` (retryable) | `requestNextAction()` throws | Retry with exponential backoff, max 3 attempts |
| `model_api_error` (non-retryable) | `requestNextAction()` throws | Block session with `system-error`, capture snapshot |
| `action_crash` | `substrate.execute()` throws | Synthesize `{outcome: "failed"}` result (Change 1), continue loop |
| `workspace_lock_conflict` | `acquireWorkspaceLock()` throws | Attempt stale-clear, retry once, then block |
| `snapshot_corruption` | `loadSnapshot()` returns invalid data | List available snapshots, fallback to oldest valid |
| `budget_exceeded` | Pre-turn budget check | Block session with budget reason, capture snapshot |
| `context_overflow` | Pre-turn token estimate | Trigger compaction (Change 3), retry turn once |

#### Changes to `runPreparedSession()`

Replace the bare catch:
```ts
} catch (error) {
  const message = error instanceof Error ? error.message : "Work engine failed.";
  transitionSession(session, "failed", message);
  // ...
}
```

With structured failure classification:
```ts
} catch (error) {
  const failure = classifyFailure(error);
  const recovered = await this.attemptRecovery(session, failure, options);
  if (!recovered) {
    transitionSession(session, "failed", describeFailure(failure));
    await this.stateStore.saveSession(session);
    this.emit(session, "session.failed", "work-core", {
      error: describeFailure(failure),
      failureKind: failure.kind,
    });
  }
  return session;
}
```

#### New helper functions

New typed error classes (added to `work-core/src/errors.ts`):

```ts
export class ModelApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "ModelApiError";
  }
}

export class WorkspaceLockError extends Error {
  constructor(message: string, public holder?: string) {
    super(message);
    this.name = "WorkspaceLockError";
  }
}
```

Classification function:

```ts
function classifyFailure(error: unknown): EngineFailure {
  if (error instanceof ModelApiError) {
    return {
      kind: "model_api_error",
      statusCode: error.statusCode,
      retryable: error.statusCode === 429 || (error.statusCode ?? 0) >= 500,
      message: error.message,
    };
  }
  if (error instanceof WorkspaceLockError) {
    return { kind: "workspace_lock_conflict", holder: error.holder };
  }
  return { kind: "action_crash", actionId: "unknown", error: String(error) };
}
```

### Verification

- Unit test: each failure kind is correctly classified
- Unit test: retryable model errors retry up to 3 times
- Unit test: action crash synthesizes result and continues loop
- Unit test: budget exceeded blocks session with correct reason

---

## Change 3: Turn State & Context Budgeting

### Problem

The `runLoop()` for-loop (line 203-243) has no state beyond the loop counter. There's no token tracking, no context windowing, and no compaction. Sessions with 10+ actions will silently exceed model context limits.

Context budgeting is a runtime survival condition, not an optimization.

### Design

#### New internal type in `work-core`

```ts
interface TurnContext {
  turnIndex: number;
  maxIterations: number;          // from ExecuteGoalOptions (default 20)
  tokenBudgetUsed: number;
  tokenBudgetLimit: number;
  lastActionOutcome?: ActionTerminalOutcome;
  compactMarkers: number[];
  cumulativeCostUsd: number;
  wallClockStartMs: number;
  budget: BudgetLimits;           // optional limits from ExecuteGoalOptions.budget
}
```

`BudgetLimits` is defined once in Change 5 (exported from work-contracts). `maxIterations` stays as a separate top-level option in `ExecuteGoalOptions` for backward compatibility. `TurnContext` merges both into its internal state.

#### Context windowing strategy (deterministic, no LLM)

**Result truncation**: Action outputs exceeding 4096 characters are truncated:
- Keep first 2048 characters
- Insert `\n[...truncated {N} characters...]\n`
- Keep last 1024 characters

Applied in `runtime.ingestToolResult()` before the result enters the model's context.

**History sliding window**: Before each `requestNextAction()`, the runtime context is rebuilt with:
- Last 5 actions: full detail (type, params, result)
- Older actions: one-line summary each: `"[turn {i}] {type}: {truncated_description} -> {outcome}"`

The window size (5) is configurable. The compacted summaries are deterministic string operations, no LLM calls.

**Compact markers**: When `tokenBudgetUsed > 0.8 * tokenBudgetLimit`, trigger compaction:
1. Reduce history window from last 5 to last 3
2. Truncate remaining action results more aggressively (2048 -> 1024 chars)
3. Record the turn index in `compactMarkers`

**Persistence**: `TurnContext` is added to `RuntimeContext` in `SessionSnapshot`:
```ts
export interface RuntimeContext {
  pendingResults: ActionResult[];
  contextPayload?: ContextPayload;
  // TurnContext is NOT stored here — it's engine-internal state (Codex review fix #6).
  // Minimal counters (tokenBudgetUsed, turnIndex) can be reconstructed from session.usage on resume.
}
```

#### Refactored `runLoop()` phases

```ts
private async runLoop(
  goal: WorkGoal,
  session: WorkSession,
  options: ExecuteGoalOptions,
  trace: WorkEvent[]
): Promise<WorkSession> {
  const turn = this.initTurnContext(options);

  while (turn.turnIndex < turn.budget.maxIterations) {
    // Phase 1: Budget check
    const budgetViolation = this.checkBudget(turn);
    if (budgetViolation) {
      return this.blockSession(session, goal, budgetViolation.message, ...);
    }

    // Phase 2: Context preparation (compact if needed)
    await this.prepareContext(session, turn);

    // Phase 3: Request next action (with retry on retryable errors)
    const response = await this.requestActionWithRetry(session, turn);

    // Phase 4: Handle response
    if (response.kind === "action") {
      const currentItem = session.items.at(-1);
      if (!currentItem) throw new Error("No active work item.");
      const blocked = await this.executeAction(session, currentItem, response.action, options.workspaceRoot);
      if (blocked) return session;
      turn.lastActionOutcome = response.action.result?.outcome;
      turn.turnIndex++;
      continue;
    }

    if (response.kind === "completion") {
      return this.completeSession(session, goal, response, options, trace);
    }

    if (response.kind === "blocked") {
      return this.blockSession(session, goal, response.reason, ...);
    }

    return this.blockSession(session, goal, response.question, ...);
  }

  return this.blockSession(session, goal, "Maximum iterations reached.", ...);
}
```

Each phase is a named method but remains in `engine.ts`. No new package until compaction logic grows large enough to warrant extraction.

#### Token estimation

The `runtime-embedded` adapter returns token usage from the model API response. Add to `RuntimeResponse`:

```ts
export type RuntimeResponse =
  | { kind: "action"; action: Action; usage?: TokenUsage }
  | { kind: "completion"; evidence: string; usage?: TokenUsage }
  | { kind: "blocked"; reason: string }
  | { kind: "clarification"; question: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
}
```

After each `requestNextAction()`, accumulate into `TurnContext`:
```ts
if (response.usage) {
  turn.tokenBudgetUsed += response.usage.inputTokens + response.usage.outputTokens;
  turn.cumulativeCostUsd += response.usage.estimatedCostUsd ?? 0;
}
```

### Verification

- Unit test: result truncation caps at 4096 chars correctly
- Unit test: history window produces correct one-line summaries
- Unit test: compaction triggers at 80% budget threshold
- Unit test: TurnContext persists in snapshot and restores correctly
- Integration test: 15-action session stays within token budget

---

## Change 4: Progress Events

### Problem

Actions are fire-and-forget until complete. During long shell commands (builds, test suites), users see nothing until the action finishes.

### Design

#### New event type in `observability/src/types.ts`

```ts
export type ActionProgressEventType = "action.progress";
```

Add to `WorkEventType` union.

Event payload:
```ts
"action.progress": {
  actionId: string;
  actionType: ActionType;
  stream: "stdout" | "stderr" | "info";
  chunk: string;
  bytesTotal?: number;
}
```

#### Changes to `exec-substrate`

Add optional callback to execution context:

```ts
export interface ExecutionContext {
  workspaceRoot: string;
  sessionId: string;
  goalId: string;
  eventBus: EventBus;
  onProgress?: (stream: "stdout" | "stderr" | "info", chunk: string) => void;  // NEW
}
```

Shell action handler pipes stdout/stderr to callback:
- Debounced: max 1 event per 200ms
- Chunked: max 4096 chars per event
- Only when `onProgress` is provided (backward compatible)

#### Changes to `engine.ts`

Pass progress callback to substrate:

```ts
const result = await this.substrate.execute(action, {
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

#### Gateway forwarding

The gateway's event WebSocket already broadcasts all events. No changes needed — surfaces automatically receive `action.progress` events.

#### Constraint

Progress events ARE persisted to JSONL traces via the existing EventBus → TraceWriter pipeline (Codex review fix #3). Adding a transient channel is unnecessary complexity. The trace size impact is bounded by debouncing (200ms) and chunking (4K max). Progress events are NOT included in snapshots.

### Verification

- Unit test: shell action with callback receives stdout/stderr chunks
- Unit test: callback not provided -> no crash (backward compatible)
- Integration test: gateway WebSocket client receives progress events
- Manual test: CLI shows live shell output during long commands

---

## Change 5: Budget Controls

### Problem

Only `maxIterations` exists as a budget control. There's no cost tracking, no token budget, no time limit. Production deployments need multi-dimensional cost controls.

### Design

#### Extended options in `work-core`

```ts
export interface ExecuteGoalOptions {
  workspaceRoot?: string;
  workspaceId?: string;
  configProfileId?: string;
  createdBy?: string;
  taskTitle?: string;
  maxIterations?: number;           // EXISTING, default 20
  resumeFrom?: { sessionId: string; snapshotId?: string };
  partialOverrideGranted?: boolean;
  budget?: BudgetLimits;            // NEW
}

export interface BudgetLimits {
  maxTokens?: number;
  maxCostUsd?: number;
  maxWallClockMs?: number;
}
```

#### Session usage tracking in `work-contracts/src/types.ts`

```ts
export interface SessionUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  wallClockMs: number;
  turnCount: number;
}
```

Add to `WorkSession`:
```ts
export interface WorkSession {
  // ... existing fields ...
  usage?: SessionUsage;  // NEW: accumulated across turns
}
```

#### Budget checking in `runLoop()`

Before each turn:
```ts
private checkBudget(turn: TurnContext): EngineFailure | null {
  if (turn.budget.maxTokens && turn.tokenBudgetUsed >= turn.budget.maxTokens) {
    return { kind: "budget_exceeded", dimension: "tokens", current: turn.tokenBudgetUsed, limit: turn.budget.maxTokens };
  }
  if (turn.budget.maxCostUsd && turn.cumulativeCostUsd >= turn.budget.maxCostUsd) {
    return { kind: "budget_exceeded", dimension: "cost", current: turn.cumulativeCostUsd, limit: turn.budget.maxCostUsd };
  }
  const elapsed = Date.now() - turn.wallClockStartMs;
  if (turn.budget.maxWallClockMs && elapsed >= turn.budget.maxWallClockMs) {
    return { kind: "budget_exceeded", dimension: "time", current: elapsed, limit: turn.budget.maxWallClockMs };
  }
  return null;
}
```

#### Blocked reason extension

Add `"budget-exceeded"` to `BlockedKind`:
```ts
export type BlockedKind =
  | "clarification-required"
  | "approval-required"
  | "verification-failed"
  | "paused-by-operator"
  | "budget-exceeded"      // NEW
  | "system-error";
```

#### Gateway and CLI integration

- `POST /api/goals` accepts optional `budget` object
- `octopus run --max-cost 0.50 --max-tokens 100000` CLI flags
- Session summary includes `usage` when present

### Verification

- Unit test: budget check returns correct failure for each dimension
- Unit test: token usage accumulates correctly across turns
- Unit test: exceeded budget blocks session with `budget-exceeded` kind
- Integration test: session with `maxCostUsd: 0.01` blocks after exceeding

---

## Files Changed Summary

| Package | File | Changes |
|---|---|---|
| `work-contracts` | `src/types.ts` | Add `ActionTerminalOutcome`, extend `ActionResult` with `outcome` + `durationMs`, add `SessionUsage`, add `BudgetLimits`, add `budget-exceeded` to `BlockedKind` |
| `observability` | `src/types.ts` | Add `action.progress` event type + payload |
| `agent-runtime` | `src/types.ts` | Add `TokenUsage` interface, add `usage?` to ALL `RuntimeResponse` variants |
| `work-core` | `src/errors.ts` | NEW: `ModelApiError`, `WorkspaceLockError` typed error classes |
| `work-core` | `src/engine.ts` | Refactor `runLoop()` with TurnContext, wrap `executeAction()` with try/catch + outcome mapping (including `timed_out`), add pre-turn AND post-response budget checks, pass `onProgress` to substrate |
| `exec-substrate` | `src/types.ts` | Add `onProgress` to `SubstrateContext` |
| `exec-substrate` | `src/substrate.ts` | Pipe shell stdout/stderr to `onProgress`, surface `timedOut` in result |
| `runtime-embedded` | `src/runtime.ts` | Add retry with backoff for 429/5xx in `requestNextAction()`, return `TokenUsage` |
| `runtime-embedded` | `src/http-client.ts` | Attach token usage to `RuntimeResponse` |
| `surfaces-cli` | `src/cli.ts` | Add `--max-cost`, `--max-tokens`, `--max-time` CLI flags |
| `gateway` | `src/routes/goals.ts` | Accept `budget` field in `POST /api/goals` |

**No new packages. No new directories. All changes fit within existing boundaries.**

---

## Implementation Order

```
Phase 1: Foundation (Changes 1 + 2)
  Step 1: Add ActionTerminalOutcome + extend ActionResult in work-contracts
  Step 2: Add EngineFailure type + classifyFailure() in work-core
  Step 3: Wrap executeAction() with try/catch + outcome mapping
  Step 4: Add denial result ingestion (ingestToolResult on security deny)
  Step 5: Add resume orphan detection in restoreSession()
  Step 6: Replace bare catch in runPreparedSession() with structured failure handling
  Step 7: Tests for all terminal outcomes + failure classifications

Phase 2: Context Intelligence (Change 3)
  Step 8: Add TurnContext type + initTurnContext()
  Step 9: Add TokenUsage to RuntimeResponse + runtime-embedded parsing
  Step 10: Implement result truncation in runtime-embedded
  Step 11: Implement history sliding window in prepareContext()
  Step 12: Implement compact markers + threshold trigger
  Step 13: Persist TurnContext in SessionSnapshot
  Step 14: Refactor runLoop() into named phases
  Step 15: Tests for truncation, windowing, compaction, persistence

Phase 3: Observability (Change 4)
  Step 16: Add action.progress event type to observability
  Step 17: Add onProgress callback to exec-substrate
  Step 18: Wire progress callback through engine.ts
  Step 19: Tests for progress events (shell, backward compat)

Phase 4: Budget Controls (Change 5)
  Step 20: Add BudgetLimits, SessionUsage, budget-exceeded to work-contracts
  Step 21: Add checkBudget() to engine.ts
  Step 22: Accumulate usage in TurnContext after each turn
  Step 23: Wire budget options through gateway + CLI
  Step 24: Tests for all budget dimensions
```

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `ActionResult.outcome` breaks existing consumers | Outcome field is required in new code but optional for backward compat during migration. Add default `"completed"` in deserialization. |
| Token estimation is approximate | Use model API response counts (accurate). Approximate only for pre-turn budget check. |
| Context windowing may lose important early context | Sliding window keeps full detail for recent actions. Older actions keep one-line summaries, not deleted. |
| Progress events increase WebSocket traffic and JSONL trace size | Debounced (200ms), chunked (4K max). Persisted to traces (acceptable). Gateway can further throttle per client. |
| Failure recovery retries may cause duplicate actions | Retry only applies to `requestNextAction()` (model API call), not to action execution. No duplicate side effects. |
