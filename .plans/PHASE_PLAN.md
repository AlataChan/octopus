# Octopus (OpenClaw Next) — Full Project Phase Plan

Status: Living Document — update as each phase completes
Source: `docs/WORK_AGENT_ARCHITECTURE.md`
Last updated: 2026-03-16

---

## Product One-Line

> A local-first, code-native work agent that turns real work goals into executable actions and durable outputs.

## Strategic Intent

This is **not** a simplification of OpenClaw.
It is a new product category: a **work agent** whose native language happens to be code.

The build order is a product statement:
- Phase 1 defines what the product *is*
- Phase 2-4 add what the product *can reach* — without redefining what it is

**Iron rule**: Each outer phase wraps the inner core. Nothing in Phase 2-4 is allowed to redefine Phase 1 semantics.

---

## Architecture Layers (Reference)

```
+--------------------------------------------------+
|              Surfaces Layer (P1/P3/P4)           |
|  CLI | TUI | Web UI | Chat | API Client          |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|           Gateway / Access Layer (P3)            |
|   optional HTTP, WebSocket, RPC                  |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|        Automation / Event Injection (P2)         |
|   cron | hooks | watchers | webhooks             |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|               Work Core (P1) ← CENTER           |
|  goal intake | work loop | artifact model        |
|  planning-lite | verification | completion       |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|             AgentRuntime (P1/P3)                 |
|  embedded(P1) | ACP(P3) | remote(P3)            |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|          Execution Substrate (P1/P4)             |
|  read | patch | shell | search | http(P4)        |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|       Workspace / State / Artifacts (P1/P2)      |
|  repo | docs | data | PLAN.md | traces           |
+--------------------------------------------------+
```

---

## Phase 1 — Core Foundation
**Theme**: A working local agent. Nothing more.

**Target user**: Single operator, local machine, interactive use.

**Completion criteria**:
- Installable alpha-quality local product
- One operator can complete real end-to-end work outside the dev environment
- Artifacts persist; traces replay
- safe-local boundary enforced

### Packages (9 total)

| Package | Role | Build |
|---------|------|-------|
| `work-contracts` | Pure domain types, no logic, no deps | tsc |
| `observability` | EventBus + JSONL trace writer/reader | tsc |
| `agent-runtime` | Runtime protocol interfaces | tsc |
| `exec-substrate` | read / patch / shell(spawn) / search | tsc |
| `state-store` | Session + artifact JSON persistence | tsc |
| `security` | safe-local policy, spawn classifier | tsc |
| `work-core` | Work loop engine, completion logic | tsc |
| `runtime-embedded` | Claude API runtime adapter | tsup |
| `surfaces-cli` | CLI: run/status/sessions/replay/config | tsup |

### Key Decisions (locked, do not revisit in P2+)

1. `work-contracts` as DAG root — breaks all circular deps
2. `spawn`/`execFile` not `exec` — no shell interpreter
3. `modelApiCall` is a separate privileged network channel (not blocked by safe-local network=disabled)
4. 4 typed substrate events: `file.read` / `file.patched` / `command.executed` / `model.call`
5. `action.requested` / `action.completed` coexist at Work Core layer (different abstraction)
6. Evidence-based completion — model self-report is NOT completion
7. Replay in P1 = JSONL trace replay only (not snapshot restore)
8. One active session owns PLAN.md/TODO.md/STATUS.md at a time

### Explicit Exclusions (not in Phase 1)

- No gateway
- No browser UI
- No MCP
- No vibe / platform security profiles
- No snapshot restore (only JSONL replay)
- No cron / automation
- No sub-agent orchestration
- No multi-channel surfaces

### Detail Plan
`.plans/phase1-work-core/task_plan.md` (v2, post Round 2 review)

### Status
- [x] Architecture review (WORK_AGENT_ARCHITECTURE.md read)
- [x] Implementation plan drafted (v1)
- [x] Codex Plan Review Round 1 — 4 findings identified
- [x] Plan updated to v2 (circular dep fix, spawn, modelApiCall, typed events)
- [x] Round 2 self-review — all 5 verification items passed
- [ ] Implementation: Step 0 — project scaffold
- [ ] Implementation: Step 1 — work-contracts
- [ ] Implementation: Step 2 — observability
- [ ] Implementation: Step 3 — exec-substrate
- [ ] Implementation: Step 4 — agent-runtime
- [ ] Implementation: Step 5 — state-store
- [ ] Implementation: Step 6 — security
- [ ] Implementation: Step 7 — work-core
- [ ] Implementation: Step 8 — runtime-embedded
- [ ] Implementation: Step 9 — surfaces-cli
- [ ] End-to-end smoke test
- [ ] Code Review (pre-merge)

---

## Phase 2 — Hardening & Automation
**Theme**: Make the core reliable, replayable, and event-driven.

**Target user**: Same individual operator, now using recurring/scheduled workflows.

**Completion criteria**:
- A paused session can be fully restored from snapshot (not just replayed)
- A cron trigger can inject work into the system without human input
- Verification flows produce structured, reviewable evidence
- vibe and platform profiles exist and are selectable

### Planned Deliverables

#### 2.1 State Snapshot + Restore
- Full `WorkSession` snapshot serialization (beyond current JSONL trace)
- `octopus restore <session-id>` — resume from snapshot, not just replay events
- Snapshot format: versioned JSON, forward-compatible
- **Why deferred from P1**: Adds complexity to state-store; P1 JSONL replay is sufficient for alpha

#### 2.2 Visible Planning Artifacts — Formal Management
- P1 writes PLAN.md/TODO.md/STATUS.md ad-hoc
- P2 formalizes: templates, ownership rules, conflict detection
- `RUNBOOK.md` generation: turn a completed session into a reusable runbook
- **Why deferred**: Content/format questions need real usage data from P1

#### 2.3 Security Profiles: `vibe` + `platform`

**vibe profile**:
- Relaxed execution restrictions
- No confirmation prompts by default
- Maximum transparency, minimum friction
- Target: experimentation, trusted local use

**platform profile**:
- Stronger policy controls for remote/shared deployment
- Stricter boundary enforcement
- Policy-file driven (not interactive confirmation)
- Target: gateway-exposed, multi-user scenarios

**Why deferred from P1**: Profile expansion before core loop is stable adds surface area without value

#### 2.4 Automation / Event Injection

Components:
- `automation` package: cron scheduler, file watcher, webhook receiver, polling jobs
- Event injection protocol: automation creates/resumes WorkSessions via stable goal binding key
- **Handoff rule**: if active session exists for goal → queue event (don't create second writer); if paused → resume; only if no session → create new
- Cron as event source, not cron as runtime host

**Why deferred from P1**: Core work loop must be stable before automation wraps it

#### 2.5 Verification Flow Hardening
- Structured verification result schema (pass/fail/partial + evidence chain)
- Verification plugins: test runner, diff checker, schema validator, output comparator
- Session cannot complete if verification is `partial` without explicit override

### Packages Added in Phase 2

| Package | Role |
|---------|------|
| `automation` | cron / watcher / webhook / poller event sources |
| Updates to `state-store` | snapshot + restore capability |
| Updates to `security` | vibe + platform profiles |
| Updates to `work-core` | runbook generation, verification hardening |

### Key Questions to Answer Before Phase 2 Planning

1. What snapshot format survives schema evolution? (versioned JSON vs event sourcing replay?)
2. What is the RUNBOOK.md template — derived from P1 real usage?
3. What does cron "binding key" look like? (goal hash? named goal? explicit ID?)
4. vibe profile confirmation UX — nothing shown, or passive log only?

---

## Phase 3 — Networked & Remote
**Theme**: Expose the core over network protocols without changing its semantics.

**Target user**: Operator accessing a local or cloud-hosted agent remotely; or building tooling on top.

**Completion criteria**:
- Remote client can attach to a session, observe events, and send control signals
- Gateway starts/stops without affecting session semantics
- ACP runtime adapter passes the same contract tests as embedded runtime
- Browser UI provides equivalent control to CLI

### Planned Deliverables

#### 3.1 Gateway (optional, not default)

- HTTP / WebSocket / RPC wrapper around Work Core sessions
- Authentication + session attachment
- Event streaming to remote clients (SSE or WebSocket)
- **Hard rule**: local operation must never require gateway. If it does, architecture has failed.
- Gateway is transport — it does not own work semantics

#### 3.2 ACP Runtime Adapter

- Second concrete `AgentRuntime` implementation
- Uses ACP (Agent Communication Protocol) as execution backend
- Must pass the same runtime contract tests as `runtime-embedded`
- Build order: Work Core loop must be stable before adapters multiply

#### 3.3 Browser / Operator UI

- Web surface equivalent to CLI
- Stream session events live
- Confirmation UI for safe-local prompts (web-based)
- Session history browser

#### 3.4 Remote Operation

- Attach to session from remote machine
- Read-only observation vs. control modes
- Disconnect without affecting session (Gateway is transport, not session host)

### Packages Added in Phase 3

| Package | Role |
|---------|------|
| `gateway` | HTTP/WS/RPC wrapper, auth, event streaming |
| `runtime-acp` | ACP-backed runtime adapter |
| `surfaces-web` | Browser/operator UI |

### Key Questions to Answer Before Phase 3 Planning

1. What auth model does gateway use? (token, mTLS, session key?)
2. ACP protocol version and stability — is it ready for production adapter?
3. Browser UI tech stack (React? SvelteKit? plain HTML + htmx?)
4. What does "remote attach" look like UX-wise — does user see the same output as local CLI?

---

## Phase 4 — Ecosystem & Compatibility
**Theme**: Connect to external tool ecosystems without letting them reshape the core.

**Target user**: Power users, platform builders, teams integrating Octopus into larger workflows.

**Completion criteria**:
- MCP tools load only when explicitly enabled; core prompt is unchanged
- External adapters integrate cleanly without touching Work Core
- Additional surfaces feel layered-on, not invasive

### Planned Deliverables

#### 4.1 MCP Compatibility Layer

- `adapter-mcp` package — loaded only when explicitly enabled in config
- No default MCP tool injection into base prompt
- MCP tools appear as optional substrate additions, not core tools
- **Rule**: MCP is at the edge. Core does not think in MCP.

#### 4.2 Additional Surfaces

- Chat surfaces (Slack, Teams, etc.) as thin wrappers — goal intake only, no execution semantics
- External operator consoles
- API client for programmatic goal submission

#### 4.3 External Adapters

- Third-party tool bridges (e.g. Jira, Linear, Notion as goal sources or artifact destinations)
- All adapters interface through the Automation layer (Phase 2), not directly into Work Core

### Packages Added in Phase 4

| Package | Role |
|---------|------|
| `adapter-mcp` | Optional MCP compatibility layer |
| `surfaces-chat` | Chat surface thin wrappers |
| External adapter packages | Per-integration (Jira, Linear, etc.) |

### Key Questions to Answer Before Phase 4 Planning

1. Which external integrations have real user demand? (don't pre-build)
2. MCP ecosystem maturity — what tools are worth supporting?
3. Chat surfaces: are they goal-intake-only or do they also show execution output?

---

## Cross-Phase Invariants

These rules apply to every phase and may never be violated:

| Invariant | Description |
|-----------|-------------|
| **Core Independence** | Work Core must be fully functional without gateway, automation, or surfaces |
| **No Hidden Execution** | Sub-agents and hidden orchestration are never a core primitive |
| **Observability Gate** | Any behavior added must emit observable events — or it is not fully designed |
| **Evidence Completion** | Session completion always requires artifact + verification evidence |
| **Workspace Scope** | All file/shell operations are bounded to workspace root |
| **One Runtime Model** | One AgentRuntime protocol, many adapters — never many runtime models |
| **Artifact-First Memory** | The system remembers through durable artifacts, not prompt context accumulation |

---

## Package Evolution Map

```
Phase 1 (foundation)
  work-contracts  observability  agent-runtime  exec-substrate
  state-store  security  work-core  runtime-embedded  surfaces-cli

Phase 2 (adds)
  + automation
  ~ state-store (snapshot+restore)
  ~ security (vibe + platform profiles)
  ~ work-core (runbook gen, verification hardening)

Phase 3 (adds)
  + gateway
  + runtime-acp
  + surfaces-web

Phase 4 (adds)
  + adapter-mcp
  + surfaces-chat
  + external adapter packages (per demand)
```

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-16 | New repo, not fork of OpenClaw | Old product shape wrong; mine for parts, not identity |
| 2026-03-16 | 4-phase build order | Prevents outer layers defining core identity too early |
| 2026-03-16 | work-contracts as DAG root | Eliminates circular dependency in monorepo |
| 2026-03-16 | spawn not exec for shell | Removes shell interpreter as attack surface |
| 2026-03-16 | modelApiCall = privileged channel | LLM calls are network but must be visible and configured, not hidden |
| 2026-03-16 | JSONL trace replay in P1, snapshot restore in P2 | P1 needs simplicity; real replay semantics need usage data |
| 2026-03-16 | Automation deferred to P2 | Core loop must be stable before event injection wraps it |
| 2026-03-16 | Gateway deferred to P3 | Local use must not require gateway; premature gateway shapes core |
| 2026-03-16 | MCP deferred to P4 | MCP at the edge only; must not become the core's language |
