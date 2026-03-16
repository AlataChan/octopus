# Findings: Work Agent Architecture Analysis

## Architecture Document Summary

Source: `docs/WORK_AGENT_ARCHITECTURE.md` (1445 lines, 22 sections)

### Core Thesis
- **Not** a lighter coding agent — a new product category: "work agent"
- Code-native, local-first, execution-oriented
- One-line: "A local-first, code-native work agent that turns real work goals into executable actions and durable outputs"

### 6-Layer Architecture
1. **Surfaces** (CLI/TUI/Web/Chat) — delivery, not product-defining
2. **Gateway** (HTTP/WS/RPC) — optional access wrapper
3. **Automation** (cron/hooks/watchers) — event injection only
4. **Work Core** — the heart: goal intake, work loop, artifact model
5. **AgentRuntime** — unified execution protocol (session plane + execution plane)
6. **Execution Substrate** — minimal tools (read, patch, shell, search)
7. **Workspace/State** — artifacts, traces, plans

### Work Core Details
- 8-step work loop: Intake → Scope → Inspect → Form → Execute → Verify → Persist → Decide
- Re-entrant: one goal may require multiple loop iterations
- Work Object Model: WorkGoal, WorkSession, WorkItem, Artifact, Observation, Action, Verification, Decision
- Evidence-based completion (not model self-report)
- Session states: created → scoped → active → blocked/verifying → completed/failed/cancelled

### Key Constraints
- Phase 1: embedded runtime only (one adapter)
- Phase 1: safe-local profile only
- No gateway in Phase 1
- No MCP in Phase 1
- No sub-agent orchestration
- Observability is a product feature, not debug feature

### Build Order (from doc)
- Phase 1: Core loop + embedded runtime + observability + safe-local
- Phase 2: Replay + planning + profile expansion + automation
- Phase 3: Gateway + browser UI + ACP runtime
- Phase 4: Surfaces + adapters + MCP

## Current Project State
- Greenfield: no existing source code
- Only `docs/WORK_AGENT_ARCHITECTURE.md` exists
- Git repo initialized with 3 commits (all doc uploads)
