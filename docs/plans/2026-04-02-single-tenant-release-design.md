# Octopus Single-Tenant Release Baseline Design

Date: 2026-04-02
Status: Proposed and approved for planning
Scope: `packages/work-contracts`, `packages/work-core`, `packages/runtime-embedded`, `packages/gateway`, `packages/state-store`, `packages/surfaces-web`, `packages/surfaces-cli`, release infra and docs

## Why This Exists

Octopus already has a real monorepo, a working local runtime, a gateway, a web surface, persistence, snapshots, and tests. It does not yet qualify as a release-ready product for internal users because the current experience still behaves like an operator prototype:

1. release gates are inconsistent (`test` passes, but `type-check` and `lint` fail)
2. the browser is still too session- and operator-centric
3. authentication is developer-oriented rather than user-oriented
4. blocked/completion flows are not yet trustworthy enough for day-to-day use
5. deployment, observability, backup, and recovery are not yet packaged as an operational product

The goal of this design is not "make the architecture nicer." The goal is:

> turn Octopus into a single-tenant internal control console that one internal team can safely use to submit work, monitor work, intervene when blocked, inspect outputs, and trust the system in production.

## Delivery Approaches Considered

### Approach A: Productize the existing stack in place

Use the current `surfaces-web` + `gateway` + `work-core` stack as the release baseline, make sessions task-centric, harden the runtime and APIs, and ship one single-tenant control console.

Pros:

- fastest path to a releasable product
- reuses the code that already has real tests and traces
- avoids maintaining two separate frontends or two backends

Cons:

- requires careful cleanup of prototype assumptions already spread across the stack

### Approach B: Keep the current web UI for operators and build a separate user frontend

Treat `surfaces-web` as an internal debug dashboard and create a brand-new frontend app for users.

Pros:

- cleaner separation between debug tooling and product UX

Cons:

- doubles frontend surface area immediately
- increases API and auth work before the core product is stable
- slower path to release

### Approach C: Go directly to a workspace-aware platform

Introduce multiple workspaces, multiple config profiles, and workspace switching in V1 even though the deployment target is still single-tenant.

Pros:

- closest to future multi-tenant evolution

Cons:

- pushes platform complexity into the first release
- increases release risk for little immediate user benefit

## Recommendation

Use **Approach A** for the release while preserving future boundaries from Approach C in the data model.

That means:

- V1 product scope serves one internal team
- V1 exposes one shared workspace and one active model/MCP profile
- V1 code should still carry `workspaceId` and `configProfileId` boundaries internally
- V1 UI must not expose workspace switching or profile switching

This keeps the release small without painting the architecture into a corner.

## Release Target

### Tenant model

- one tenant only
- one internal team
- one shared workspace root
- one active runtime configuration
- one active MCP server set

### User roles

V1 should support three roles even in single-tenant mode:

- `viewer`: can see sessions, artifacts, status, and traces
- `operator`: can create tasks and intervene in blocked sessions
- `admin`: can manage runtime config, gateway settings, credentials, and maintenance actions

The UI can initially expose one login screen and role-aware controls. It must not expose self-serve user management.

#### Role to permission mapping

The gateway already uses granular permissions. V1 should make the role mapping explicit:

| Role | Permissions |
| --- | --- |
| `viewer` | `sessions.list`, `sessions.read`, `config.read` |
| `operator` | `sessions.list`, `sessions.read`, `config.read`, `goals.submit`, `sessions.control`, `sessions.approve` |
| `admin` | `sessions.list`, `sessions.read`, `config.read`, `goals.submit`, `sessions.control`, `sessions.approve`, `runtime.proxy` |

Clarification submission follows the same intervention boundary:

- `viewer`: cannot submit clarifications
- `operator`: can submit clarifications
- `admin`: can submit clarifications

### Product promise

The released system must let an internal team:

1. log into a browser console
2. submit a task with clear instructions
3. see task/session state transition in near real time
4. inspect artifacts and event history
5. answer clarifications and approvals
6. pause, cancel, resume, or rollback when appropriate
7. trust that all actions are authenticated, logged, and recoverable

## In Scope

### Product scope

- browser login
- task publish flow
- task/session monitoring
- blocked-state intervention
- artifact preview
- checkpoints and rollback visibility
- system health view
- audit/event visibility

### Engineering scope

- release gates: `test`, `type-check`, `lint`, `build`
- stable CLI packaging and documented run path
- hardened gateway APIs and WS flows
- runtime completion reliability improvements
- persistent blocked payloads and intervention semantics
- deployment packaging
- operational runbook
- CI release pipeline

## Out of Scope

- multi-tenant routing
- workspace switching in the UI
- per-project model profile switching
- self-serve account management
- billing, quotas, or chargeback
- external end-user portal
- browser automation substrate
- SQL substrate

These can be added later on top of the release baseline.

## Definition Of Release Ready

The project is release-ready only when all of the following are true:

### Engineering quality

- `pnpm test` passes
- `pnpm run type-check` passes
- `pnpm lint` passes
- `pnpm build` passes
- the browser bundle is production-built and smoke-tested
- the CLI entrypoint is executable through a documented supported command

### Runtime trustworthiness

- a representative task can complete end-to-end in the target environment
- blocked states always carry actionable structured reasons
- approvals and clarifications survive restart
- artifacts, snapshots, and traces are durable across process restarts
- completion cannot succeed without required evidence

### Product usability

- users can create a task from the frontend without reading source code
- users can understand why a task is blocked
- users can inspect artifacts without direct filesystem access
- users can tell whether the system is healthy and connected
- the UI uses task-oriented labels rather than raw IDs as the primary information hierarchy

### Operational readiness

- deployment instructions are reproducible
- runtime secrets are not edited directly in source code
- TLS deployment path is documented
- logs, traces, and backups have retention guidance
- rollback procedure is documented and tested
- release builds and CI use Node.js 20.19+ or 22.x so Vite 7 runs on a supported runtime

## Architecture Decisions

### Decision 1: The browser becomes the primary product surface

`surfaces-web` should no longer behave like a debug dashboard first. It becomes the primary single-tenant product surface.

The CLI remains essential for:

- local development
- recovery operations
- advanced eval and pack workflows
- emergency admin operations

But internal users should not need the CLI to run daily tasks.

### Decision 2: Session remains the core execution record

V1 should not introduce a separate persistent `Task` aggregate unless the current session model becomes a blocker.

Instead:

- `WorkSession` remains the durable execution record
- the frontend labels it as a task run
- `namedGoalId` and `goalSummary` become first-class product labels
- internal metadata adds `workspaceId` and `configProfileId`

This avoids unnecessary data-model sprawl in V1.

### Decision 3: Add scope fields now, keep them single-valued in V1

Even in single-tenant mode, the persisted model should carry:

- `workspaceId`
- `configProfileId`
- `createdBy`

Default values can be:

- `workspaceId = "default"`
- `configProfileId = "default"`

This allows later evolution without rewriting storage formats again.

### Decision 4: Move blocked interaction to first-class product contracts

Blocked states must be explicit and actionable. V1 supports these structured reasons:

- `clarification-required`
- `approval-required`
- `verification-failed`
- `paused-by-operator`
- `system-error`

Gateway and frontend must not infer these from raw strings. They should use structured payloads directly.

Implementation rule:

- `system-error` must be added to the shared `BlockedKind` union
- raw blocked strings from runtime/model layers must be normalized before they reach product-facing APIs
- normalization should follow deterministic rules:
  - explicit runtime `clarification` responses remain `clarification-required`
  - policy-driven risky actions remain `approval-required`
  - completion predicate failures map to `verification-failed`
  - operator pauses map to `paused-by-operator`
  - runtime/model/transport/parser failures map to `system-error`
  - unknown blocked strings default to `system-error` and preserve the original message in `evidence`

### Decision 5: Add HTTP fallback for human intervention

WebSocket should remain the real-time channel, but release behavior cannot depend exclusively on a live socket.

V1 should support:

- WS for live event streaming
- HTTP for task submission
- HTTP for approval submission
- HTTP for clarification submission
- HTTP for control actions

This makes the product simpler to operate and easier to test.

Important nuance:

- the current stack already supports WebSocket clarification handling
- V1 work is to add HTTP clarification parity and shared permission semantics, not to replace the existing WS path

### Decision 6: Release config must be environment-driven

The release baseline should not rely on editing `.octopus/config.json` by hand in production.

Use:

- environment variables for secrets
- config file or env for non-secret defaults
- a documented startup contract for gateway and web deployment

The existing local config file remains useful for development only.

### Decision 7: Static single-tenant users come from environment configuration

V1 should not add a database just to support internal user login.

Use env-configured static users. Recommended format:

```json
OCTOPUS_USERS_JSON='[
  {"username":"admin","passwordHash":"scrypt$...","role":"admin"},
  {"username":"ops1","passwordHash":"scrypt$...","role":"operator"},
  {"username":"viewer1","passwordHash":"scrypt$...","role":"viewer"}
]'
```

Recommended hashing approach:

- use Node built-in `scrypt`
- avoid adding native password dependencies such as `bcrypt` in V1
- validate password hashes inside the gateway at login time

The gateway bootstrap API key remains an operational secret for admin/bootstrap flows only.

### Decision 8: Token behavior is restart-volatile in V1

V1 may keep the server token store in memory if documented clearly.

Implications:

- gateway restart invalidates all browser sessions
- users must log in again after restart
- this is acceptable for the first internal release

Browser persistence should still survive page refresh:

- store auth tokens in `sessionStorage`
- do not ship an in-memory-only browser auth store in the released UI

## Frontend Product Design

### Primary navigation

V1 should use a task-centered application shell with these sections:

1. `Tasks`
2. `Task Detail`
3. `Artifacts`
4. `Events`
5. `System`

This can still live in one page layout, but the information hierarchy should clearly separate task execution from system health.

### Required frontend capabilities

#### 1. Login

- username/password
- token-based browser session
- explicit session expiry and logout
- auth survives page refresh within the active browser session

#### 2. Task composer

- title
- instruction
- optional constraints
- optional pack selection
- inline guidance and examples

#### 3. Task list

- task-first labels
- state chips
- updated time
- created by
- filters: all / active / blocked / completed / failed / cancelled

#### 4. Task detail

- overview card
- current state
- structured blocked reason
- actions timeline
- verification summary
- current plan / todo / status artifact shortcuts

#### 5. Interventions

- pause
- cancel
- resume blocked session
- approve / deny risky action
- answer clarification
- rollback to checkpoint

#### 6. Artifact viewer

- markdown/text preview
- raw content view
- copy path
- unsupported type messaging

#### 7. System page

- gateway health
- runtime config summary
- active connections
- profile name
- trace storage status
- latest incidents or failures

### UX rules

- primary labels must be human-readable task labels, not raw session IDs
- blocked reasons must always answer "what happened" and "what should I do next"
- no control may imply a backend capability that is not implemented
- advanced operator/debug details should be visible but secondary
- the browser must work on desktop first and mobile second; V1 is admin-console responsive, not mobile-native

## Backend And API Design

### Required API capabilities

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/token`
- `GET /api/status`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/events`
- `GET /api/sessions/:id/snapshots`
- `GET /api/sessions/:id/artifacts/content`
- `POST /api/goals`
- `POST /api/sessions/:id/control`
- `POST /api/sessions/:id/approval`
- `POST /api/sessions/:id/clarification`

The current gateway already covers most of this surface. V1 mainly needs cleanup, auth hardening, and clarification over HTTP.

Important nuance:

- `GET /api/sessions/:id/snapshots` already exists
- V1 work is to expose it properly in the frontend and pair it with rollback visibility
- `POST /auth/token` remains the bootstrap path for API-key CLI/admin flows
- `POST /auth/login` is the browser-facing username/password login route
- `POST /auth/logout` revokes the current browser token server-side

### Required API contract changes

- task submission must accept title-alias metadata
- session summary responses must include product-facing title fields
- blocked reason must be returned as structured data
- auth responses must be browser-safe and role-aware
- session summary/detail responses must carry enough metadata for task-first rendering without client-side guesswork

## Reliability And Completion Model

The current system shows evidence that model calls can return too early and get blocked by the completion predicate without doing real work. That is acceptable in a prototype and unacceptable in a release.

V1 must improve this in three places:

1. prompt quality
   - stronger instructions on when completion is allowed
   - stronger requirement to produce at least one actionable step when the goal implies work
2. runtime parsing and validation
   - reject malformed or premature completions with explicit telemetry
3. completion semantics
   - enrich failure reason when the completion predicate fails
   - persist enough context so the operator can understand whether the task failed because of model behavior, missing evidence, or missing artifacts

## Auth And Security Design

### Release baseline

- browser login must not require raw gateway API key entry by end users
- gateway API key remains an admin bootstrap secret, not the product login UX
- operator tokens must be short-lived
- roles must gate sensitive actions
- non-loopback deployment must require TLS
- token invalidation on gateway restart is acceptable in V1 if called out in the runbook and UI copy

### Operational security

- secrets from environment or external secret manager
- audit event for login, logout, task submit, approval, cancel, rollback, config change
- deny-by-default posture for risky tools in release profile
- user account configuration comes from `OCTOPUS_USERS_JSON` or equivalent documented env-driven source

## Deployment Model

### V1 deployment target

Single host or single environment is acceptable if it includes:

- gateway service
- static web app hosting
- persistent `.octopus` data directory or equivalent mounted volume
- TLS termination
- backup job for session/snapshot/trace data

### Release artifacts

- production build command
- container image or documented process manager startup
- example env file
- reverse proxy example
- admin runbook
- Node.js base image pinned to 20.19+ or 22.x

## Testing Strategy

### Automated

- unit tests for contract, runtime, gateway, and web components
- integration tests for blocked/resume flows
- browser smoke test for login, task creation, blocked-state display, artifact preview
- release CI running `test`, `type-check`, `lint`, `build`
- CI and release images must use Node.js 20.19+ or 22.x so Vite 7 runs on a supported version

### Manual UAT

- login as viewer/operator/admin
- create task from browser
- observe active task
- trigger clarification
- trigger approval
- preview artifacts
- rollback to checkpoint
- restart service and verify durability

## Release Milestones

### Milestone 1: Engineering baseline green

- all release gates pass
- CLI entrypoint and docs are coherent
- current web build is stable

### Milestone 2: Trustworthy execution core

- blocked/completion semantics are trustworthy
- restart durability is verified
- structured interventions are complete

### Milestone 3: Productized single-tenant console

- task publish and monitoring UX complete
- auth and roles complete
- artifact/event/checkpoint experience complete

### Milestone 4: Go-live readiness

- deployment packaging complete
- runbook complete
- UAT signoff complete

## Future-Proofing Rules

The release implementation must preserve these future seams even if they are hidden in V1:

- `workspaceId`
- `configProfileId`
- role-aware permissions
- scoped storage layout
- task-centric UI routes that can later be workspace-scoped

V1 should not expose multi-workspace behavior, but it should not block it.
