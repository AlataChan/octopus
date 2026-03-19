# Task-Centered Web Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the browser usable for real Octopus task trials by adding browser task creation, human-readable session labels, truthful blocked-state controls, and safe artifact preview.

**Architecture:** Keep the existing dashboard shell, i18n layer, and `App.tsx` data flow, but add one durable session field (`goalSummary`), one gateway execution requirement (`workspaceRoot` carried inside `GatewayConfig` for browser-submitted goals), and one new read-only artifact-content route with explicit session/path safety checks. On the frontend, layer a small `TaskComposer` and `ArtifactPreviewModal` onto the current app rather than introducing routing, a state library, or a full file browser.

**Tech Stack:** Preact 10, TypeScript 5, Vitest 3, `@testing-library/preact`, existing `@octopus/work-contracts`, `@octopus/work-core`, `@octopus/state-store`, and `@octopus/gateway` packages.

**Execution Context:** Continue in the current repository workflow on `main`; do not create a separate worktree for this slice.

---

### Task 1: Persist `goalSummary` Through Session Creation and Listing

**Files:**
- Modify: `packages/work-contracts/src/types.ts`
- Modify: `packages/work-core/src/engine.ts`
- Modify: `packages/work-core/src/__tests__/engine.test.ts`
- Modify: `packages/state-store/src/session-serde.ts`
- Modify: `packages/state-store/src/store.ts`
- Modify: `packages/state-store/src/__tests__/store.test.ts`
- Modify: `packages/surfaces-web/src/__tests__/fixtures.ts`

**Step 1: Write the failing tests**

Add one focused `WorkEngine` test in `packages/work-core/src/__tests__/engine.test.ts` that executes a goal with a long human-language description and expects:
- `session.goalSummary` to be populated
- the summary to preserve the original language
- the summary to be shorter than the raw description

Extend `packages/state-store/src/__tests__/store.test.ts` so `listSessions()` returns `goalSummary`, and add one backward-compatibility assertion that loading older stored sessions without `goalSummary` still works.

**Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @octopus/work-core test
pnpm --filter @octopus/state-store test
```

Expected:
- the new `goalSummary` assertions fail because `WorkSession` / `SessionSummary` do not yet carry the field
- serialization and list-session expectations fail for the same reason

**Step 3: Write the minimal implementation**

Implement the contract and persistence chain:
- add `goalSummary?: string` to `WorkSession` and `SessionSummary` in `packages/work-contracts/src/types.ts`
- in `packages/work-core/src/engine.ts`, derive `goalSummary` once when starting a fresh session
- keep derivation simple and language-preserving
  - trim whitespace
  - collapse repeated whitespace
  - truncate to a rail-friendly length such as ~60 characters
- serialize / hydrate `goalSummary` in `packages/state-store/src/session-serde.ts`
- expose `goalSummary` from `packages/state-store/src/store.ts#listSessions`
- update `packages/surfaces-web/src/__tests__/fixtures.ts` so UI tests can construct session summaries and sessions with `goalSummary`

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @octopus/work-core test
pnpm --filter @octopus/state-store test
```

Expected: both projects pass with the new summary field covered by tests.

**Step 5: Commit**

```bash
git add packages/work-contracts/src/types.ts packages/work-core/src/engine.ts packages/work-core/src/__tests__/engine.test.ts packages/state-store/src/session-serde.ts packages/state-store/src/store.ts packages/state-store/src/__tests__/store.test.ts packages/surfaces-web/src/__tests__/fixtures.ts
git commit -m "feat: persist goal summaries for sessions"
```

### Task 2: Make Gateway Goal Submission Workspace-Aware

**Files:**
- Modify: `packages/gateway/src/types.ts`
- Modify: `packages/gateway/src/routes/shared.ts`
- Modify: `packages/gateway/src/routes/goals.ts`
- Modify: `packages/gateway/src/server.ts`
- Modify: `packages/gateway/src/__tests__/server.test.ts`
- Modify: `packages/surfaces-cli/src/factory.ts`

**Step 1: Write the failing test**

Add a `GatewayServer` test in `packages/gateway/src/__tests__/server.test.ts` that:
- dispatches `POST /api/goals` with `{ description, namedGoalId }`
- expects the fake engine to receive a `WorkGoal` with `namedGoalId`
- expects `engine.executeGoal()` to be called with `{ workspaceRoot: "/workspace" }`
- keeps the server test helper constructing `GatewayServer` with the existing object-literal `GatewayConfig` pattern rather than a new positional constructor argument

Update the test helper server factory to track engine calls explicitly.

**Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @octopus/gateway test
```

Expected: the new assertion fails because gateway submission currently calls `engine.executeGoal(goal, {})`.

**Step 3: Write the minimal implementation**

Pass `workspaceRoot` through the gateway stack:
- add `workspaceRoot: string` to `GatewayConfig` in `packages/gateway/src/types.ts`
- add `workspaceRoot` to `RouteDeps` in `packages/gateway/src/routes/shared.ts`
- have `GatewayServer` read `workspaceRoot` from its existing `config` object and include it in `createRouteDeps()`
- update `packages/surfaces-cli/src/factory.ts#toGatewayConfig` so the returned `GatewayConfig` includes the top-level local-app `workspaceRoot`
- change `packages/gateway/src/routes/goals.ts` to call `deps.engine.executeGoal(goal, { workspaceRoot: deps.workspaceRoot })`

Do not add a new positional constructor parameter to `GatewayServer` for this slice. Reuse the existing object-literal config pattern and thread `workspaceRoot` through `GatewayConfig`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @octopus/gateway test
```

Expected: gateway tests pass, including the new workspace-aware goal submission case.

**Step 5: Commit**

```bash
git add packages/gateway/src/types.ts packages/gateway/src/routes/shared.ts packages/gateway/src/routes/goals.ts packages/gateway/src/server.ts packages/gateway/src/__tests__/server.test.ts packages/surfaces-cli/src/factory.ts
git commit -m "feat: execute browser-submitted goals in workspace context"
```

### Task 3: Add Browser Task Composer and Empty-State Guidance

**Files:**
- Create: `packages/surfaces-web/src/components/TaskComposer.tsx`
- Modify: `packages/surfaces-web/src/App.tsx`
- Modify: `packages/surfaces-web/src/api/client.ts`
- Modify: `packages/surfaces-web/src/i18n/messages.ts`
- Modify: `packages/surfaces-web/src/styles/index.css`
- Modify: `packages/surfaces-web/src/__tests__/app.test.tsx`

**Step 1: Write the failing test**

Extend `packages/surfaces-web/src/__tests__/app.test.tsx` with an integration test that:
- renders the app with no initial sessions
- shows task composer guidance and example tasks
- submits a new task with title + instruction
- expects `submitGoal()` to be called with both `description` and `namedGoalId`
- expects the session list to refresh after submission

Mock `submitGoal()` on the fake `GatewayClient` the same way the existing test already mocks `listSessions()` / `getSession()` / `getStatus()`.

**Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected:
- the new test fails because there is no task composer
- `GatewayClient.submitGoal()` only accepts a raw description today

**Step 3: Write the minimal implementation**

Implement a lightweight browser submission flow:
- create `TaskComposer.tsx` with:
  - optional task title input
  - required task instruction textarea
  - one-sentence writing guidance
  - two short example tasks
- change `GatewayClient.submitGoal(...)` in `packages/surfaces-web/src/api/client.ts` to accept an object:
  - `description`
  - `namedGoalId?`
- in `App.tsx`:
  - add a `New Task` button in the header
  - show the composer when there is no selected task or when the user explicitly opens it
  - on submit, call `client.submitGoal({ description, namedGoalId })`
  - refresh sessions and select the returned session
  - keep errors localized through the existing i18n layer
- add only the i18n keys needed for composer labels, guidance, examples, and submit button text

Do not add constraints, output-path fields, routing, or a multi-step wizard.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: the app test suite passes with browser task submission covered.

**Step 5: Commit**

```bash
git add packages/surfaces-web/src/components/TaskComposer.tsx packages/surfaces-web/src/App.tsx packages/surfaces-web/src/api/client.ts packages/surfaces-web/src/i18n/messages.ts packages/surfaces-web/src/styles/index.css packages/surfaces-web/src/__tests__/app.test.tsx
git commit -m "feat: add browser task composer"
```

### Task 4: Make the Session Rail Task-First and Remove Misleading Resume

**Files:**
- Modify: `packages/surfaces-web/src/components/SessionList.tsx`
- Modify: `packages/surfaces-web/src/components/SessionDetail.tsx`
- Modify: `packages/surfaces-web/src/components/ControlBar.tsx`
- Modify: `packages/surfaces-web/src/i18n/messages.ts`
- Modify: `packages/surfaces-web/src/styles/index.css`
- Modify: `packages/surfaces-web/src/__tests__/session-list.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/session-detail.test.tsx`

**Step 1: Write the failing tests**

Update `packages/surfaces-web/src/__tests__/session-list.test.tsx` to expect:
- `namedGoalId` as the primary label when present
- `goalSummary` as the primary fallback when title is absent
- the raw `session.id` only as supporting technical text

Update `packages/surfaces-web/src/__tests__/session-detail.test.tsx` to expect:
- a blocked/intervention card when the session is blocked
- the latest transition reason to be visible
- no generic `Continue` button in the control area

**Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected:
- session list assertions fail because the UI still leads with UUIDs
- session detail assertions fail because there is no blocked-reason card and the control bar still exposes resume

**Step 3: Write the minimal implementation**

Implement the truthful task-first UI:
- in `SessionList.tsx`
  - render primary label as `namedGoalId ?? goalSummary ?? shortSessionId`
  - render secondary line as `goalSummary` only when it adds information beyond the title
  - keep the technical `session.id` visible but visually de-emphasized
- in `SessionDetail.tsx`
  - show a dedicated blocked/intervention card when `session.state === "blocked"`
  - prefer the latest transition reason as the explanation source
  - keep approval UI intact
- in `ControlBar.tsx`
  - remove the generic resume/continue button entirely for this phase
  - keep pause and cancel only
- add the required i18n strings and visual styles

Do not attempt to invent resume semantics in this task.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: session list and session detail tests pass with task-first labeling and truthful controls.

**Step 5: Commit**

```bash
git add packages/surfaces-web/src/components/SessionList.tsx packages/surfaces-web/src/components/SessionDetail.tsx packages/surfaces-web/src/components/ControlBar.tsx packages/surfaces-web/src/i18n/messages.ts packages/surfaces-web/src/styles/index.css packages/surfaces-web/src/__tests__/session-list.test.tsx packages/surfaces-web/src/__tests__/session-detail.test.tsx
git commit -m "feat: make session rail task-first"
```

### Task 5: Add Safe Artifact Preview Route and Browser Modal

**Files:**
- Create: `packages/gateway/src/routes/artifacts.ts`
- Modify: `packages/gateway/src/server.ts`
- Modify: `packages/gateway/src/__tests__/server.test.ts`
- Create: `packages/surfaces-web/src/components/ArtifactPreviewModal.tsx`
- Modify: `packages/surfaces-web/src/App.tsx`
- Modify: `packages/surfaces-web/src/api/client.ts`
- Modify: `packages/surfaces-web/src/components/SessionDetail.tsx`
- Modify: `packages/surfaces-web/src/i18n/messages.ts`
- Modify: `packages/surfaces-web/src/styles/index.css`
- Modify: `packages/surfaces-web/src/__tests__/app.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/session-detail.test.tsx`

**Step 1: Write the failing tests**

Add one gateway test in `packages/gateway/src/__tests__/server.test.ts` that:
- requests artifact content for a registered session artifact such as `PLAN.md`
- expects a 200 response with body content
- requests `../../etc/passwd` or any unregistered path and expects rejection

Add one web integration test in `packages/surfaces-web/src/__tests__/app.test.tsx` that:
- opens an artifact preview action from the selected session
- expects the client to fetch artifact content
- expects a modal with the artifact contents to appear

Update `packages/surfaces-web/src/__tests__/session-detail.test.tsx` so text-like artifacts expose a preview action while unsupported types render a disabled/secondary state.

**Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @octopus/gateway test
pnpm --filter @octopus/surfaces-web test
```

Expected:
- gateway tests fail because there is no artifact-content route
- web tests fail because artifact rows are still inert labels

**Step 3: Write the minimal implementation**

Implement the safe artifact read path:
- create `packages/gateway/src/routes/artifacts.ts`
- add `GET /api/sessions/:id/artifacts/content?path=...` in `packages/gateway/src/server.ts`
- in the route:
  - load the target session
  - confirm the requested `path` matches an artifact already registered on that session
  - resolve and normalize the path against the gateway workspace root carried on `GatewayConfig`
  - reject traversal outside the workspace
  - allow only text-like artifact types in this phase
  - return JSON with at least `path`, `type`, `contentType`, and `content`

Implement the frontend preview flow:
- add `GatewayClient.getArtifactContent(sessionId, path)`
- create `ArtifactPreviewModal.tsx`
- keep preview state in `App.tsx`, not inside `SessionDetail`
- pass preview handlers into `SessionDetail`
- render preview/open controls only for supported artifact types
- add a path-copy action if straightforward, but do not block the task on clipboard support

Do not add a general-purpose file browser or reuse the right-side status rail.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @octopus/gateway test
pnpm --filter @octopus/surfaces-web test
```

Expected: both suites pass, including route safety and modal preview behavior.

**Step 5: Commit**

```bash
git add packages/gateway/src/routes/artifacts.ts packages/gateway/src/server.ts packages/gateway/src/__tests__/server.test.ts packages/surfaces-web/src/components/ArtifactPreviewModal.tsx packages/surfaces-web/src/App.tsx packages/surfaces-web/src/api/client.ts packages/surfaces-web/src/components/SessionDetail.tsx packages/surfaces-web/src/i18n/messages.ts packages/surfaces-web/src/styles/index.css packages/surfaces-web/src/__tests__/app.test.tsx packages/surfaces-web/src/__tests__/session-detail.test.tsx
git commit -m "feat: add artifact preview from browser"
```

### Task 6: Run Full Verification and Manual Real-Task Trial

**Files:**
- Modify only if verification exposes regressions

**Step 1: Run focused package verification**

Run:

```bash
pnpm --filter @octopus/work-contracts test
pnpm --filter @octopus/work-core test
pnpm --filter @octopus/state-store test
pnpm --filter @octopus/gateway test
pnpm --filter @octopus/surfaces-web test
pnpm --filter @octopus/gateway type-check
pnpm --filter @octopus/surfaces-web type-check
pnpm --filter @octopus/surfaces-web build
```

Expected: all targeted package tests, type-checks, and the web build pass.

**Step 2: Run workspace verification**

Run:

```bash
pnpm test
pnpm type-check
git diff --check
```

Expected:
- workspace tests stay green
- root type-check stays green
- no whitespace / conflict-marker issues remain

**Step 3: Run one manual browser trial**

Start the local app and submit a small real task from the browser, for example:

```text
任务标题：README 摘要
任务说明：读取 README.md，并在 docs/trial-summary.md 里写出 5 条中文要点；不要修改其它源码文件。
```

Verify manually:
- the new task appears in the rail with human-readable labeling
- the session writes visible artifacts instead of silently headless-running
- blocked states explain why they blocked
- text artifacts can be previewed from the modal

**Step 4: Final review**

Inspect:

```bash
git diff --stat
```

Confirm the slice still obeys Phase A boundaries:
- no chat UI
- no fake resume
- no general file browser
- no extra state library

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: close task-centered browser workflow gaps"
```
