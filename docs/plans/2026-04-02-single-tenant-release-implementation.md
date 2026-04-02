# Single-Tenant Release Baseline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Octopus into a release-ready single-tenant internal control console with frontend task submission, monitoring, intervention, and operational readiness.

**Architecture:** Keep the existing monorepo and execution core, but harden it into a product baseline. Reuse `work-core`, `gateway`, and `surfaces-web` rather than creating a second application. Add product-facing task metadata, structured intervention APIs, role-aware auth, release gates, and deployment packaging while preserving future seams for `workspaceId` and `configProfileId`.

**Tech Stack:** TypeScript 5, Node.js 20.19+ or 22.x, pnpm 10, Vitest 3, ESLint 9, Preact 10, Vite 7, existing `@octopus/*` workspace packages, WebSocket + HTTP gateway.

**Precondition:** Execute this plan from a dedicated git worktree before making code changes.

---

## Release Gates

Before any milestone can be called done, these commands must pass:

```bash
pnpm test
pnpm run type-check
pnpm lint
pnpm build
```

All local, CI, and release-image verification must run on Node.js 20.19+ or 22.x because Vite 7 does not officially support 20.12.x.

The final release candidate must also pass the product smoke flow:

```bash
pnpm build
node packages/surfaces-cli/dist/index.js gateway run --profile vibe
```

And a browser verification checklist:

1. login succeeds
2. create task succeeds
3. active task appears in the task list
4. blocked task shows intervention UI
5. artifact preview opens
6. system status page loads

## Task 1: Restore Engineering Baseline

**Files:**
- Modify: `tsconfig.json`
- Modify: `packages/eval-runner/src/__tests__/scorer.test.ts`
- Modify: `packages/eval-runner/src/scorer.ts`
- Modify: `packages/runtime-embedded/src/runtime.ts`
- Modify: `packages/security/src/__tests__/policy-reexport.test.ts`
- Modify: `packages/work-core/src/__tests__/engine-resume.test.ts`
- Modify: `packages/surfaces-cli/package.json`
- Modify: `packages/surfaces-web/package.json`
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Write failing guard tests or assertions where missing**

Add or update tests covering:

- root type-check includes frontend TSX sources
- CLI distribution remains executable as documented
- no floating promise or unused-variable lint violations remain in touched files

**Step 2: Run failing quality checks**

Run:

```bash
pnpm run type-check
pnpm lint
```

Expected: fail on the current known root `tsconfig` / lint issues.

**Step 3: Implement minimal fixes**

Apply these fixes:

- root `tsconfig.json` must include `packages/**/*.tsx` or move to project references
- rename or remove unused imports and variables
- await the floating promise assertion in `scorer.test.ts`
- clear the current `consistent-type-imports` warning in `policy-reexport.test.ts` so lint stays clean if warnings are elevated later
- ensure CLI release docs point to a supported command path
- raise the documented and enforced Node floor to 20.19+ or 22.x in package metadata and docs

If the CLI is meant to be invoked from the built package, add an explicit release path in `README.md`:

```bash
node packages/surfaces-cli/dist/index.js
```

If it is meant to be workspace-executable, document the exact `pnpm` command that works in this repo.

**Step 4: Run quality gates again**

Run:

```bash
pnpm run type-check
pnpm lint
pnpm build
```

Expected: all pass.

**Step 5: Commit**

```bash
git add tsconfig.json packages/eval-runner/src/__tests__/scorer.test.ts packages/eval-runner/src/scorer.ts packages/runtime-embedded/src/runtime.ts packages/security/src/__tests__/policy-reexport.test.ts packages/work-core/src/__tests__/engine-resume.test.ts packages/surfaces-cli/package.json packages/surfaces-web/package.json package.json README.md
git commit -m "fix: restore release quality gates"
```

## Task 2: Add Release-Scoped Session Metadata

**Files:**
- Modify: `packages/work-contracts/src/types.ts`
- Modify: `packages/work-contracts/src/factories.ts`
- Modify: `packages/work-contracts/src/__tests__/constructors.test.ts`
- Modify: `packages/state-store/src/session-serde.ts`
- Modify: `packages/state-store/src/__tests__/session-serde.test.ts`
- Modify: `packages/gateway/src/routes/goals.ts`
- Modify: `packages/gateway/src/routes/sessions.ts`
- Modify: `packages/surfaces-web/src/api/client.ts`
- Modify: `packages/surfaces-web/src/__tests__/fixtures.ts`

**Step 1: Write failing contract tests**

Add tests for:

- `workspaceId` defaulting to `"default"`
- `configProfileId` defaulting to `"default"`
- `createdBy` persisting through session serialization
- session summary exposing task-facing title fields

**Step 2: Run focused tests**

Run:

```bash
pnpm --filter @octopus/work-contracts test
pnpm --filter @octopus/state-store test
pnpm --filter @octopus/gateway test
```

Expected: fail until new fields are wired through.

**Step 3: Implement minimal schema changes**

Extend the session model with:

```ts
workspaceId: string;
configProfileId: string;
createdBy?: string;
taskTitle?: string;
```

Rules:

- defaults are `"default"` for scope fields
- `taskTitle` is optional and used only as the product-facing primary label
- `namedGoalId` remains available for backward compatibility
- follow the current `session-serde.ts` pattern of conditional field inclusion so old persisted sessions and snapshots still hydrate correctly
- update frontend session summary parsing at the same time so the browser can actually consume `taskTitle` and `createdBy`

Update session summary APIs to return:

- `taskTitle`
- `goalSummary`
- `state`
- `updatedAt`
- `createdBy`

**Step 4: Re-run focused tests**

Expected: pass.

**Step 5: Commit**

```bash
git add packages/work-contracts/src/types.ts packages/work-contracts/src/factories.ts packages/work-contracts/src/__tests__/constructors.test.ts packages/state-store/src/session-serde.ts packages/state-store/src/__tests__/session-serde.test.ts packages/gateway/src/routes/goals.ts packages/gateway/src/routes/sessions.ts packages/surfaces-web/src/api/client.ts packages/surfaces-web/src/__tests__/fixtures.ts
git commit -m "feat: add release-scoped session metadata"
```

## Task 3: Harden Blocked And Completion Semantics

**Files:**
- Modify: `packages/work-contracts/src/types.ts`
- Modify: `packages/work-contracts/src/__tests__/blocked-reason.test.ts`
- Modify: `packages/runtime-embedded/src/prompt-builder.ts`
- Modify: `packages/runtime-embedded/src/response-parser.ts`
- Modify: `packages/runtime-embedded/src/runtime.ts`
- Modify: `packages/runtime-embedded/src/__tests__/prompt-builder.test.ts`
- Modify: `packages/runtime-embedded/src/__tests__/response-parser.test.ts`
- Modify: `packages/work-core/src/engine.ts`
- Modify: `packages/work-core/src/__tests__/engine.test.ts`
- Modify: `packages/work-core/src/__tests__/engine-resume.test.ts`

**Step 1: Write failing tests**

Add tests for:

- goals that imply real work cannot complete without at least one action or explicit artifact evidence
- completion predicate failures persist structured reasons instead of generic strings
- blocked reason includes `system-error` when the model call fails or completion is invalid

**Step 2: Run focused tests**

Run:

```bash
pnpm --filter @octopus/runtime-embedded test
pnpm --filter @octopus/work-core test
```

Expected: fail until the runtime and engine semantics are tightened.

**Step 3: Implement runtime and engine changes**

Strengthen the prompt:

- require action-first behavior for work goals
- explicitly forbid completion without evidence
- describe when clarification is appropriate

Strengthen the engine:

- preserve structured blocked reasons
- distinguish completion failure from pause and clarification
- emit richer telemetry for premature completion

Do not weaken the completion predicate. Make its failure more actionable.

Required implementation details:

- add `system-error` to the shared `BlockedKind` union in `@octopus/work-contracts`
- do not require the model to emit a structured blocked object in V1
- instead, normalize raw blocked strings deterministically in `work-core` before returning product-facing state
- use this mapping rule:
  - explicit runtime `clarification` response -> `clarification-required`
  - policy-driven approval pause -> `approval-required`
  - `"Completion predicate failed."` -> `verification-failed`
  - `"Paused by operator."` -> `paused-by-operator`
  - model call, parser, transport, or unknown blocked strings -> `system-error`
- preserve the original blocked message in `evidence` for `verification-failed` and `system-error`

**Step 4: Re-run tests**

Expected: pass.

**Step 5: Commit**

```bash
git add packages/work-contracts/src/types.ts packages/work-contracts/src/__tests__/blocked-reason.test.ts packages/runtime-embedded/src/prompt-builder.ts packages/runtime-embedded/src/response-parser.ts packages/runtime-embedded/src/runtime.ts packages/runtime-embedded/src/__tests__/prompt-builder.test.ts packages/runtime-embedded/src/__tests__/response-parser.test.ts packages/work-core/src/engine.ts packages/work-core/src/__tests__/engine.test.ts packages/work-core/src/__tests__/engine-resume.test.ts
git commit -m "feat: harden blocked and completion semantics"
```

## Task 4: Add First-Class Clarification And Intervention APIs

**Files:**
- Modify: `packages/gateway/src/routes/shared.ts`
- Create: `packages/gateway/src/routes/clarification.ts`
- Modify: `packages/gateway/src/server.ts`
- Modify: `packages/gateway/src/ws/event-stream.ts`
- Modify: `packages/gateway/src/__tests__/server.test.ts`
- Modify: `packages/gateway/src/__tests__/ws.test.ts`
- Modify: `packages/surfaces-web/src/api/client.ts`

**Step 1: Write failing API tests**

Add tests for:

- `POST /api/sessions/:id/clarification`
- role enforcement for clarification submission
- consistent behavior between WS clarification and HTTP clarification
- `viewer` is forbidden while `operator` and `admin` are allowed

**Step 2: Run gateway tests**

Run:

```bash
pnpm --filter @octopus/gateway test
```

Expected: fail until the new route and client contract exist.

**Step 3: Implement the route**

The current stack already supports WebSocket clarification messages. The new work here is smaller:

- keep the existing WS clarification handler
- add HTTP clarification parity
- keep both paths aligned on the same permission rules and engine call
- gate both HTTP and WS clarification submission with `sessions.approve`

Add a clarification route that submits:

```json
{ "answer": "..." }
```

and internally calls:

```ts
deps.engine.resumeBlockedSession(sessionId, { kind: "clarification", answer })
```

Keep WS support, but treat HTTP as release-critical fallback.

**Step 4: Update browser client**

Add a client method:

```ts
submitClarification(sessionId: string, answer: string): Promise<void>
```

and use it when WS is unavailable.

**Step 5: Re-run tests**

Expected: pass.

**Step 6: Commit**

```bash
git add packages/gateway/src/routes/shared.ts packages/gateway/src/routes/clarification.ts packages/gateway/src/server.ts packages/gateway/src/ws/event-stream.ts packages/gateway/src/__tests__/server.test.ts packages/gateway/src/__tests__/ws.test.ts packages/surfaces-web/src/api/client.ts
git commit -m "feat: add release-safe clarification APIs"
```

## Task 5: Replace Browser API-Key Login With Role-Aware Single-Tenant Auth

**Files:**
- Modify: `packages/gateway/src/auth.ts`
- Modify: `packages/gateway/src/routes/auth-routes.ts`
- Modify: `packages/gateway/src/middleware/auth-middleware.ts`
- Modify: `packages/gateway/src/types.ts`
- Modify: `packages/gateway/src/__tests__/auth.test.ts`
- Modify: `packages/surfaces-web/src/api/auth.ts`
- Modify: `packages/surfaces-web/src/components/LoginForm.tsx`
- Modify: `packages/surfaces-web/src/api/client.ts`
- Modify: `packages/surfaces-web/src/__tests__/app.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/smoke.test.tsx`

**Step 1: Write failing auth tests**

Cover:

- login with operator credentials
- role-specific permissions
- logout / token invalidation
- browser login no longer requires the raw gateway bootstrap API key

**Step 2: Decide the minimal auth storage**

For V1, use one of these:

- env-configured static operator accounts with hashed passwords
- reverse-proxy injected identity headers with trusted proxy validation

Recommended: static operator accounts first, because it is self-contained.

Required auth decisions for V1:

- use `OCTOPUS_USERS_JSON` as the documented user source
- use Node built-in `scrypt` for password verification
- keep server-issued session tokens in the existing in-memory token store for V1
- document that gateway restart invalidates all login sessions

Document this exact env shape in `.env.example` later:

```json
OCTOPUS_USERS_JSON='[
  {"username":"admin","passwordHash":"scrypt$...","role":"admin"},
  {"username":"ops1","passwordHash":"scrypt$...","role":"operator"},
  {"username":"viewer1","passwordHash":"scrypt$...","role":"viewer"}
]'
```

And this exact role mapping in code and tests:

| Role | Permissions |
| --- | --- |
| `viewer` | `sessions.list`, `sessions.read`, `config.read` |
| `operator` | `sessions.list`, `sessions.read`, `config.read`, `goals.submit`, `sessions.control`, `sessions.approve` |
| `admin` | `sessions.list`, `sessions.read`, `config.read`, `goals.submit`, `sessions.control`, `sessions.approve`, `runtime.proxy` |

**Step 3: Implement auth changes**

Keep the existing endpoint split explicit:

- keep `POST /auth/token` for API-key bootstrap and CLI/admin flows
- add `POST /auth/login` for username/password browser login
- add `POST /auth/logout` for server-side token revocation

Expose the dedicated browser login endpoint:

```json
{ "username": "...", "password": "..." }
```

Return:

```json
{ "token": "...", "expiresAt": "...", "role": "operator" }
```

Preserve the gateway API key only as an admin bootstrap path and do not expose it in normal UI copy.

Also ensure:

- WebSocket auth accepts the issued bearer token path used by the browser
- operator context includes role-derived permissions on both HTTP and WS paths
- `POST /auth/logout` revokes the active token via `tokenStore.revokeToken()`
- frontend logout clears local auth state only after the server revocation request completes or explicitly falls back when the token is already invalid/expired

**Step 4: Update the frontend**

Replace the API key form with:

- username
- password
- session expiry feedback
- `SessionStorageAuthStore` or equivalent browser-backed auth persistence

Hide controls the current role cannot use.

**Step 5: Re-run tests**

Run:

```bash
pnpm --filter @octopus/gateway test
pnpm --filter @octopus/surfaces-web test
```

Expected: pass.

**Step 6: Commit**

```bash
git add packages/gateway/src/auth.ts packages/gateway/src/routes/auth-routes.ts packages/gateway/src/middleware/auth-middleware.ts packages/gateway/src/types.ts packages/gateway/src/__tests__/auth.test.ts packages/surfaces-web/src/api/auth.ts packages/surfaces-web/src/components/LoginForm.tsx packages/surfaces-web/src/api/client.ts packages/surfaces-web/src/__tests__/app.test.tsx packages/surfaces-web/src/__tests__/smoke.test.tsx
git commit -m "feat: add single-tenant role-aware auth"
```

## Task 6: Build The Release Frontend For Task Publish And Monitoring

**Files:**
- Modify: `packages/surfaces-web/src/App.tsx`
- Modify: `packages/surfaces-web/src/components/TaskComposer.tsx`
- Modify: `packages/surfaces-web/src/components/SessionList.tsx`
- Modify: `packages/surfaces-web/src/components/SessionDetail.tsx`
- Modify: `packages/surfaces-web/src/components/StatusPanel.tsx`
- Modify: `packages/surfaces-web/src/components/ClarificationDialog.tsx`
- Modify: `packages/surfaces-web/src/components/ApprovalDialog.tsx`
- Modify: `packages/surfaces-web/src/components/ArtifactPreviewModal.tsx`
- Modify: `packages/surfaces-web/src/styles/index.css`
- Modify: `packages/surfaces-web/src/i18n/messages.ts`
- Modify: `packages/surfaces-web/src/__tests__/app.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/session-detail.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/task-composer.test.tsx`

**Step 1: Write failing UI tests**

Add tests for:

- task creation with title + instruction
- session list shows task title first
- blocked card shows exact intervention state
- artifact preview open/close
- system panel shows role and health metadata

**Step 2: Run web tests**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: fail until the product shell is updated.

**Step 3: Implement the product shell**

Most of the UI components already exist. Treat this as a productization pass, not a greenfield build.

V1 frontend must provide:

- task composer with title and instruction
- task list with filters and clear state badges
- task detail with overview, blocked card, artifacts, events, checkpoints
- system panel with health and config summary
- role-aware controls

Do not add chat UI. Keep it task-centered.

Localization rule:

- update both `zh-CN` and `en-US` entries inside `packages/surfaces-web/src/i18n/messages.ts`
- do not add product strings in only one locale

**Step 4: Implement responsive behavior**

Desktop-first rules:

- left rail for tasks
- main content for task detail
- right rail or modal for system and artifact detail

Mobile fallback:

- stacked layout
- full-screen modal for artifact preview

**Step 5: Re-run web tests**

Expected: pass.

**Step 6: Commit**

```bash
git add packages/surfaces-web/src/App.tsx packages/surfaces-web/src/components/TaskComposer.tsx packages/surfaces-web/src/components/SessionList.tsx packages/surfaces-web/src/components/SessionDetail.tsx packages/surfaces-web/src/components/StatusPanel.tsx packages/surfaces-web/src/components/ClarificationDialog.tsx packages/surfaces-web/src/components/ApprovalDialog.tsx packages/surfaces-web/src/components/ArtifactPreviewModal.tsx packages/surfaces-web/src/styles/index.css packages/surfaces-web/src/i18n/messages.ts packages/surfaces-web/src/__tests__/app.test.tsx packages/surfaces-web/src/__tests__/session-detail.test.tsx packages/surfaces-web/src/__tests__/task-composer.test.tsx
git commit -m "feat: productize single-tenant control console"
```

## Task 7: Expose Checkpoints, Rollback, And Audit Visibility

**Files:**
- Modify: `packages/gateway/src/routes/sessions.ts`
- Modify: `packages/gateway/src/routes/status.ts`
- Modify: `packages/gateway/src/__tests__/server.test.ts`
- Modify: `packages/surfaces-web/src/api/client.ts`
- Modify: `packages/surfaces-web/src/components/SessionDetail.tsx`
- Modify: `packages/surfaces-web/src/__tests__/session-detail.test.tsx`
- Modify: `packages/surfaces-cli/src/cli.ts`

**Step 1: Write failing tests**

Cover:

- snapshots visible in task detail
- rollback action available only to admin/operator
- status endpoint includes enough information for the system page

**Step 2: Implement API/UI changes**

Note:

- `GET /api/sessions/:id/snapshots` already exists
- the real V1 delta is frontend visibility, rollback affordance, and richer system/status metadata

Expose:

- session snapshot list
- latest checkpoint timestamp
- rollback action
- recent trace availability

The browser does not need full raw trace download in V1, but it should show that audit data exists.

**Step 3: Re-run tests**

Expected: pass.

**Step 4: Commit**

```bash
git add packages/gateway/src/routes/sessions.ts packages/gateway/src/routes/status.ts packages/gateway/src/__tests__/server.test.ts packages/surfaces-web/src/api/client.ts packages/surfaces-web/src/components/SessionDetail.tsx packages/surfaces-web/src/__tests__/session-detail.test.tsx packages/surfaces-cli/src/cli.ts
git commit -m "feat: surface checkpoints and audit visibility"
```

## Task 8: Package Deployment And Operations

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.release.yml`
- Create: `docs/runbooks/single-tenant-release.md`
- Create: `.env.example`
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Write deployment checklist first**

Document:

- required env vars
- persistent volume mounts
- TLS assumption
- reverse proxy expectation
- backup job expectation

**Step 2: Create packaging**

Support a release path that builds:

- gateway service
- static web assets

Decide whether the web is:

- served by the gateway process, or
- deployed as a static app behind the same reverse proxy

Recommended: static web build behind reverse proxy plus gateway API service.

Pin the runtime explicitly:

- Docker base image must use Node.js 20.19+ or 22.x
- CI examples and runbooks must use the same floor

**Step 3: Add operational runbook**

Include:

- start
- stop
- restart
- rotate credentials
- restore snapshots
- inspect failed task
- backup and restore `.octopus`

**Step 4: Verify packaging**

Run:

```bash
pnpm build
docker build -t octopus-release .
```

If using compose:

```bash
docker compose -f docker-compose.release.yml up
```

**Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.release.yml docs/runbooks/single-tenant-release.md .env.example README.md package.json
git commit -m "chore: add release packaging and runbook"
```

## Task 9: Add Release CI And Browser Verification

**Files:**
- Create: `.github/workflows/release-quality.yml`
- Create: `packages/surfaces-web/src/__tests__/release-smoke.test.tsx`
- Modify: `vitest.config.ts`
- Modify: `README.md`

**Step 1: Add CI workflow**

The workflow must run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run type-check
pnpm lint
pnpm build
```

and must use Node.js 20.19+ or 22.x explicitly in the workflow.

**Step 2: Add browser smoke assertions**

Cover:

- login form renders
- task composer renders
- blocked card renders
- system panel renders

**Step 3: Re-run all quality gates**

Expected: pass locally before relying on CI.

**Step 4: Commit**

```bash
git add .github/workflows/release-quality.yml packages/surfaces-web/src/__tests__/release-smoke.test.tsx vitest.config.ts README.md
git commit -m "ci: add release quality pipeline"
```

## Task 10: Run UAT And Freeze The Release Candidate

**Files:**
- Create: `docs/uat/single-tenant-release-checklist.md`
- Create: `docs/uat/single-tenant-release-signoff.md`
- Modify: `README.md`

**Step 1: Write UAT checklist**

Include:

- login
- create task
- watch task run
- handle clarification
- approve risky action
- inspect artifacts
- rollback to checkpoint
- restart and verify persistence
- verify viewer/operator/admin permissions

**Step 2: Execute UAT manually**

Record:

- pass/fail
- issue found
- resolution
- retest result

**Step 3: Freeze release candidate**

Only after UAT signoff:

- tag the release
- publish the deployment artifact
- ship the runbook and env contract with it

**Step 4: Commit**

```bash
git add docs/uat/single-tenant-release-checklist.md docs/uat/single-tenant-release-signoff.md README.md
git commit -m "docs: add single-tenant release UAT artifacts"
```

## Priority Mapping

### P0: Must finish before any user-facing release

- Task 1: Restore Engineering Baseline
- Task 2: Add Release-Scoped Session Metadata
- Task 3: Harden Blocked And Completion Semantics
- Task 4: Add First-Class Clarification And Intervention APIs
- Task 5: Replace Browser API-Key Login With Role-Aware Single-Tenant Auth
- Task 6: Build The Release Frontend For Task Publish And Monitoring
- Task 8: Package Deployment And Operations
- Task 9: Add Release CI And Browser Verification
- Task 10: Run UAT And Freeze The Release Candidate

### P1: Strongly recommended in the same release cycle

- Task 7: Expose Checkpoints, Rollback, And Audit Visibility

### P2: Explicitly defer until after the release baseline

- multi-workspace switching
- multiple runtime profiles in UI
- self-serve user management
- billing or quotas
- workspace-level RBAC

## Dependency And Parallelization Notes

- Task 1 is the hard prerequisite for every other task because release gates must be trustworthy first
- Tasks 2, 3, and 4 should remain sequential because metadata, blocked semantics, and intervention APIs build on each other
- Task 5 can start after Task 1 in parallel with Tasks 2-4 because auth is largely orthogonal
- Task 6 depends on both Task 5 and the output of Tasks 2-4
- Task 7 follows Task 6 because checkpoint and audit visibility are surfaced through the product shell

## Final Verification Commands

Before claiming the project is release-ready, run:

```bash
pnpm test
pnpm run type-check
pnpm lint
pnpm build
node packages/surfaces-cli/dist/index.js config
node packages/surfaces-cli/dist/index.js gateway run --profile vibe
```

Then complete the browser UAT checklist in `docs/uat/single-tenant-release-checklist.md`.
