# Octopus Memory Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Phase 1 long-term memory support through a new `@octopus/memory` package, typed contracts, observable injection, and manual CLI promotion.

**Architecture:** Memory is an in-process TypeScript package backed by per-user JSON/Markdown files under `~/.octopus/memory`. Work-core receives a `MemoryPort`, retrieves only when `session.skillContext` is explicit and memory is enabled, injects a fenced memory block into `ContextPayload`, and records outcomes on terminal session states. CLI writes are manual and source-anchored.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Node `fs/promises`, no new third-party dependencies.

---

### Task 1: Shared Contract Fields

**Files:**
- Modify: `packages/work-contracts/src/types.ts`
- Modify: `packages/work-contracts/src/factories.ts`
- Test: `packages/work-contracts/src/__tests__/constructors.test.ts`

**Step 1: Write the failing test**

Add a constructor test that creates a session with `skillContext: "dev"` and asserts:

```ts
expect(session.skillContext).toBe("dev");
expect(session.injectionPlanIds).toEqual([]);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @octopus/work-contracts test -- constructors`

Expected: FAIL because `CreateWorkSessionInput` and `WorkSession` do not expose the memory fields.

**Step 3: Write minimal implementation**

Add:

```ts
export type SkillId = "dev" | "ops" | "content" | "law" | "finance" | "molt";
```

Add optional `skillContext?: SkillId` and `injectionPlanIds?: string[]` to `WorkSession` and `SessionSummary`. Add `skillContext?: SkillId` to `CreateWorkSessionInput`; initialize `injectionPlanIds: []` in `createWorkSession`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @octopus/work-contracts test -- constructors`

Expected: PASS.

### Task 2: Persistence And Observability Contracts

**Files:**
- Modify: `packages/state-store/src/session-serde.ts`
- Test: `packages/state-store/src/__tests__/session-serde.test.ts`
- Modify: `packages/observability/src/types.ts`
- Test: `packages/observability/src/__tests__/contract.test.ts`

**Step 1: Write failing tests**

Add a serde round-trip test asserting `skillContext` and `injectionPlanIds` survive serialization and hydration.

Add observability contract assertions for these events:

```ts
"memory.retrieved"
"memory.injected"
"memory.promoted"
"memory.outcome"
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @octopus/state-store test -- session-serde
pnpm --filter @octopus/observability test -- contract
```

Expected: FAIL because the fields/events are not typed.

**Step 3: Write minimal implementation**

Preserve optional `skillContext` and `injectionPlanIds` in `serializeWorkSession` and `hydrateWorkSession`. Add `MemoryEventType` and payload interfaces for retrieved/injected/promoted/outcome in `packages/observability/src/types.ts`, then wire them into `WorkEventType` and `EventPayloadByType`.

**Step 4: Run tests to verify they pass**

Run the same two package test commands.

Expected: PASS.

### Task 3: Memory Package Skeleton And Schemas

**Files:**
- Create: `packages/memory/package.json`
- Create: `packages/memory/tsconfig.json`
- Create: `packages/memory/src/index.ts`
- Create: `packages/memory/src/port.ts`
- Create: `packages/memory/src/schemas/skill.ts`
- Create: `packages/memory/src/schemas/memory-record.ts`
- Modify: `vitest.config.ts`
- Test: `packages/memory/src/__tests__/schema.test.ts`

**Step 1: Write failing schema tests**

Test that valid records parse and invalid records fail for bad skill, bad version, missing source, and unsupported inactive Phase 1 storage scope.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @octopus/memory test -- schema`

Expected: FAIL because the package does not exist.

**Step 3: Write minimal implementation**

Create the package with `build`, `type-check`, and `test` scripts. Export `MemoryPort`, `MemoryRecord`, `SkillId`, type guards, and constants. Use hand-written guards only.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @octopus/memory test -- schema`

Expected: PASS.

### Task 4: Filesystem Store, Retrieval, Planner, And Outcome Log

**Files:**
- Create: `packages/memory/src/store/filesystem-store.ts`
- Create: `packages/memory/src/store/log.ts`
- Create: `packages/memory/src/retrieval/keyword-retriever.ts`
- Create: `packages/memory/src/retrieval/scope-filter.ts`
- Create: `packages/memory/src/injection/planner.ts`
- Create: `packages/memory/src/injection/formatter.ts`
- Create: `packages/memory/src/outcomes/outcome-recorder.ts`
- Test: `packages/memory/src/__tests__/store.test.ts`
- Test: `packages/memory/src/__tests__/retrieval.test.ts`
- Test: `packages/memory/src/__tests__/planner.test.ts`

**Step 1: Write failing tests**

Cover:
- empty/missing skill index returns `[]`
- active skill records with matching keywords rank above non-matches
- workspace-qualified records match only the same workspace
- planner respects `maxItems` and token budget
- formatter renders `### Relevant Prior Knowledge ###`
- outcome recorder appends `memory.outcome` operations to JSONL

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @octopus/memory test`

Expected: FAIL because modules are missing.

**Step 3: Write minimal implementation**

Implement local JSON index loading, append-only operation logging, deterministic keyword scoring, scope/owner filtering, budget selection, prompt formatting, and outcome logging.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @octopus/memory test`

Expected: PASS.

### Task 5: Source-Anchored Promotion API

**Files:**
- Create: `packages/memory/src/promotion/promote-from-source.ts`
- Modify: `packages/memory/src/store/filesystem-store.ts`
- Modify: `packages/memory/src/index.ts`
- Test: `packages/memory/src/__tests__/promotion.test.ts`

**Step 1: Write failing tests**

Cover trace-event source validation, artifact path validation, freeform source requiring a reason, deterministic record IDs, index updates, long-term Markdown append, and `memory.promoted` operation logging.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @octopus/memory test -- promotion`

Expected: FAIL because promotion is not implemented.

**Step 3: Write minimal implementation**

Implement `promoteFromSource`, requiring valid source anchors before writing active skill-scoped records. Reject missing source details and inactive storage scopes.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @octopus/memory test -- promotion`

Expected: PASS.

### Task 6: Runtime Prompt Memory Block

**Files:**
- Modify: `packages/agent-runtime/src/types.ts`
- Modify: `packages/runtime-embedded/src/prompt-builder.ts`
- Test: `packages/runtime-embedded/src/__tests__/prompt-builder.test.ts`

**Step 1: Write failing test**

Add a prompt-builder test where `context.memoryBlock` includes one item. Assert the prompt contains:

```text
### Relevant Prior Knowledge ###
- [decision:<id>] <content>
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @octopus/runtime-embedded test -- prompt-builder`

Expected: FAIL because `ContextPayload` and the builder omit memory.

**Step 3: Write minimal implementation**

Add `memoryBlock?: { planId: string; items: Array<{ id: string; content: string; kind: string }> }` to `ContextPayload` and render it in the embedded prompt.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @octopus/runtime-embedded test -- prompt-builder`

Expected: PASS.

### Task 7: Work-Core Injection And Outcome Recording

**Files:**
- Modify: `packages/work-core/package.json`
- Modify: `packages/work-core/src/engine.ts`
- Test: `packages/work-core/src/__tests__/engine.test.ts`

**Step 1: Write failing tests**

Add engine tests for:
- no `skillContext` means no memory calls
- `OCTOPUS_MEMORY=off` means no memory calls
- explicit `skillContext` retrieves, plans, injects into runtime context, stores plan ID, emits `memory.retrieved` and `memory.injected`
- completed session records `memory.outcome` for accumulated plan IDs

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @octopus/work-core test -- engine`

Expected: FAIL because `WorkEngine` has no `MemoryPort`.

**Step 3: Write minimal implementation**

Add optional `memory?: MemoryPort` to `WorkEngineOptions`. In `refreshRuntimeContext`, when enabled and `session.skillContext` exists, call `retrieve`, `planInjection`, attach `memoryBlock`, append the plan ID, and emit memory events. On completion/failure/block terminal handling, call `recordInjectionOutcome` for saved plan IDs.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @octopus/work-core test -- engine`

Expected: PASS.

### Task 8: CLI Memory Commands

**Files:**
- Modify: `packages/surfaces-cli/package.json`
- Modify: `packages/surfaces-cli/src/cli.ts`
- Modify: `packages/surfaces-cli/src/factory.ts`
- Test: `packages/surfaces-cli/src/__tests__/cli.test.ts`

**Step 1: Write failing CLI tests**

Cover:
- `octopus memory list --skill dev`
- `octopus memory show <id>`
- `octopus memory reject <id>`
- `octopus memory promote --skill dev --kind note --content text --no-source --reason manual`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @octopus/surfaces-cli test -- cli`

Expected: FAIL because commands and memory factory wiring do not exist.

**Step 3: Write minimal implementation**

Create the default filesystem memory port in `createLocalWorkEngine` using `join(config.dataDir, "memory")` unless a memory root override is later added. Add `memory` to `LocalApp`. Wire the four `octopus memory` subcommands to `MemoryPort`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @octopus/surfaces-cli test -- cli`

Expected: PASS.

### Task 9: Full Verification

**Files:**
- Modify as required by prior tasks only.

**Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @octopus/memory test
pnpm --filter @octopus/work-contracts test
pnpm --filter @octopus/observability test
pnpm --filter @octopus/runtime-embedded test
pnpm --filter @octopus/work-core test
pnpm --filter @octopus/surfaces-cli test
```

Expected: PASS.

**Step 2: Run full verification**

Run:

```bash
pnpm run type-check
pnpm test
pnpm build
```

Expected: all commands exit 0. Record any pre-existing warnings separately from failures.
