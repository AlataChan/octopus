# Phase 1 Implementation Plan: Work Agent Core

Status: v2 — Post Codex Review (Round 1 integrated)
Source: `docs/WORK_AGENT_ARCHITECTURE.md`
Scope: Phase 1 — Core loop + embedded runtime + observability + minimum safe-local

---

## Changelog from v1 (Codex Round 1 Review)

| # | Change | Reason |
|---|--------|--------|
| 1 | Add `work-contracts` package (Step 0) | Eliminate circular deps: work-core types consumed by agent-runtime/state-store/security before work-core itself is built |
| 2 | Shell tool: `exec` → `spawn`/`execFile` with explicit argv | `exec` uses shell interpreter — enables chaining, absolute-path bypass, escapes |
| 3 | Security: add `modelApiCall` privileged channel | embedded runtime calls Anthropic API, which conflicts with "network disabled" without an explicit exception |
| 4 | Observability: 4 typed substrate events + contract test gate | `action.*/payload` too generic; file read/patch/command/model call need explicit typed events |
| 5 | Replay pinned = JSONL trace replay | Phase 1 `octopus replay` = structured trace replay, NOT session snapshot restore (Phase 2) |
| 6 | Build tooling: tsc for internal packages, tsup for deliverables only | tsup bundling per-package amplifies dep boundary issues; tsc output is sufficient for monorepo internal packages |

---

## 0. Project Setup

### 0.1 Repository & Toolchain
- **Language**: TypeScript (strict mode, ESM)
- **Runtime**: Node.js >= 20 (LTS)
- **Package manager**: pnpm + workspaces (monorepo)
- **Build (internal packages)**: tsc (TypeScript compiler direct output, no bundling)
- **Build (deliverables)**: tsup — only `surfaces-cli` and `runtime-embedded`
- **Test**: vitest
- **Lint**: eslint + prettier
- **Monorepo structure**: pnpm workspaces

### 0.2 Monorepo Package Layout (9 packages)
```
packages/
  work-contracts/     # [NEW] Pure domain types — shared by all packages, no logic, no deps
  work-core/          # Work loop engine, completion logic, artifact management
  agent-runtime/      # Runtime protocol definition (interfaces + event model)
  runtime-embedded/   # Local embedded runtime adapter (Phase 1 only runtime) [tsup bundle]
  exec-substrate/     # read, patch, shell (spawn), search
  state-store/        # Session metadata, artifact indexes
  observability/      # Event bus + JSONL trace persistence
  security/           # Safety profiles (Phase 1: safe-local only)
  surfaces-cli/       # CLI surface [tsup bundle]
```

### 0.3 Shared Config
- `tsconfig.base.json` at root (strict, ESM, composite: true for project references)
- `vitest.workspace.ts` at root
- `.eslintrc.cjs` at root

---

## 1. Domain Types (`work-contracts`)

**This package is the dependency root. It must contain only type definitions and pure value constructors — no I/O, no async, no external deps.**

### 1.1 Core Domain Types

```typescript
// WorkGoal: desired outcome, constraints, success criteria
export interface WorkGoal {
  id: string;
  description: string;
  constraints?: string[];
  successCriteria?: string[];
  createdAt: Date;
}

// WorkSession: active execution context for a goal
export interface WorkSession {
  id: string;
  goalId: string;
  state: SessionState;
  items: WorkItem[];
  observations: Observation[];
  artifacts: Artifact[];
  transitions: StateTransition[];
  createdAt: Date;
  updatedAt: Date;
}

export type SessionState =
  | 'created' | 'scoped' | 'active' | 'blocked'
  | 'verifying' | 'completed' | 'failed' | 'cancelled';

// WorkItem: scoped unit of work inside a session
export interface WorkItem {
  id: string;
  sessionId: string;
  description: string;
  state: WorkItemState;
  observations: Observation[];
  actions: Action[];
  verifications: Verification[];
  createdAt: Date;
}

export type WorkItemState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

// Artifact: any durable output
export interface Artifact {
  id: string;
  type: 'code' | 'script' | 'report' | 'dataset' | 'patch' | 'document' | 'runbook' | 'other';
  path: string;
  description: string;
  createdAt: Date;
}

// Observation: discovered fact about the environment or workload
export interface Observation {
  id: string;
  content: string;
  source: string;  // e.g. 'file:README.md', 'shell:git log', 'api:response'
  createdAt: Date;
}

// Action: concrete programmatic step
export interface Action {
  id: string;
  type: ActionType;
  params: Record<string, unknown>;
  result?: ActionResult;
  createdAt: Date;
}

export type ActionType = 'read' | 'patch' | 'shell' | 'search' | 'model-call';

export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
}

// Verification: evidence that action moved toward completion
export interface Verification {
  id: string;
  method: string;
  passed: boolean;
  evidence: string;
  createdAt: Date;
}

// Decision: the reasoned choice to continue, stop, escalate, or re-scope
export interface Decision {
  id: string;
  type: 'continue' | 'stop' | 'escalate' | 'rescope';
  reason: string;
  createdAt: Date;
}

// StateTransition: auditable record of every session state change
export interface StateTransition {
  from: SessionState;
  to: SessionState;
  reason: string;
  triggerEvent: string;
  artifactRefs?: string[];
  timestamp: Date;
}
```

### 1.2 Completion Predicate Types
```typescript
export interface CompletionEvidence {
  targetArtifactExists: boolean;
  verificationRecorded: boolean;
  limitationsPersisted: boolean;
  stateDurable: boolean;
}

// A session may enter 'completed' only if ALL four are true
export function isCompletable(evidence: CompletionEvidence): boolean {
  return (
    evidence.targetArtifactExists &&
    evidence.verificationRecorded &&
    evidence.limitationsPersisted &&
    evidence.stateDurable
  );
}
```

**Files**: `packages/work-contracts/src/types.ts`, `packages/work-contracts/src/completion.ts`, `packages/work-contracts/src/index.ts`
**Tests**: `packages/work-contracts/src/__tests__/completion.test.ts`

---

## 2. Event Model (`observability`)

Must be defined second because all layers emit events.

### 2.1 Base Event Envelope
```typescript
export interface WorkEvent {
  id: string;
  timestamp: Date;
  sessionId: string;
  goalId: string;
  workItemId?: string;
  type: WorkEventType;
  sourceLayer: 'work-core' | 'runtime' | 'substrate' | 'automation' | 'surface';
  causalityRef?: string;   // parent event id for causality chain
  artifactRefs?: string[];
  payload: EventPayload;   // typed union, not Record<unknown>
  policyMeta?: PolicyMeta;
}
```

### 2.2 Event Types — Session & WorkItem (15 base events)
```typescript
export type SessionEventType =
  | 'session.started' | 'session.blocked' | 'session.completed'
  | 'session.failed' | 'session.cancelled';

export type WorkItemEventType =
  | 'workitem.started' | 'workitem.completed'
  | 'workitem.skipped' | 'workitem.failed';

export type CoreEventType =
  | 'context.loaded' | 'decision.made'
  | 'action.requested' | 'action.completed'
  | 'verification.requested' | 'verification.completed'
  | 'artifact.emitted';
```

### 2.3 Typed Substrate Events (4 explicit, strongly-typed — NEW)
These replace the generic `action.*` for substrate operations:
```typescript
export type SubstrateEventType =
  | 'file.read'          // explicit file read with path + size
  | 'file.patched'       // explicit file write with path + bytes + optional diff
  | 'command.executed'   // shell execution: executable, args, exit code, duration
  | 'model.call';        // LLM API call: provider, model, tokens in/out

// Typed payload schemas (not Record<unknown>)
export interface FileReadPayload {
  path: string;
  sizeBytes: number;
  encoding: string;
}

export interface FilePatchedPayload {
  path: string;
  bytesWritten: number;
  diff?: string;  // unified diff if available
}

export interface CommandExecutedPayload {
  executable: string;
  args: string[];
  exitCode: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
}

export interface ModelCallPayload {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  endpoint: string;
}

export type WorkEventType =
  | SessionEventType | WorkItemEventType | CoreEventType | SubstrateEventType;
```

### 2.4 Event Bus
- In-process EventEmitter-based bus
- Typed subscriptions per event type
- No buffering — live consumers (CLI renderer, trace writer) subscribe directly

### 2.5 JSONL Trace Persistence
- Append-only JSONL: `.octopus/traces/<session-id>.jsonl`
- One event per line, serialized with `JSON.stringify`
- **Replay in Phase 1 = reading this JSONL file and re-emitting events** (not session snapshot restore)
- `octopus replay <session-id>` reads the JSONL and renders it through the CLI renderer

### 2.6 Contract Test Gate (Design Enforcement)
```typescript
// Every critical substrate action MUST appear in the trace.
// These are not optional assertions — they are the gate.
describe('observability contract', () => {
  it('emits file.read for every read tool call', ...);
  it('emits file.patched for every patch tool call', ...);
  it('emits command.executed for every shell tool call', ...);
  it('emits model.call for every LLM API call', ...);
  it('emits session.completed only after evidence-based predicate passes', ...);
});
```

**Files**: `packages/observability/src/types.ts`, `packages/observability/src/event-bus.ts`, `packages/observability/src/trace-writer.ts`, `packages/observability/src/trace-reader.ts`
**Tests**: `packages/observability/src/__tests__/event-bus.test.ts`, `packages/observability/src/__tests__/trace-writer.test.ts`, `packages/observability/src/__tests__/contract.test.ts`

---

## 3. Execution Substrate (`exec-substrate`)

### 3.1 Tool Interface
```typescript
export interface SubstrateTool<P = unknown, R extends ToolResult = ToolResult> {
  name: string;
  execute(params: P, context: SubstrateContext): Promise<R>;
}

export interface SubstrateContext {
  workspaceRoot: string;
  sessionId: string;
  eventBus: EventBus;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
```

### 3.2 Default Tools (Phase 1)

| Tool | Description | Implementation |
|------|-------------|----------------|
| `read` | Read file contents | `fs.readFile`, emits `file.read` event |
| `patch` | Write/patch file | `fs.writeFile`, emits `file.patched` event |
| `shell` | Execute command | **`child_process.spawn`** (not exec), emits `command.executed` event |
| `search` | Find files / grep content | `glob` + regex, emits `file.read` events per match |

`http` excluded from Phase 1.

### 3.3 Shell Tool — `spawn` Implementation (KEY CHANGE from v1)

```typescript
interface ShellParams {
  executable: string;  // e.g. 'git', 'node', 'python3'
  args: string[];      // e.g. ['log', '--oneline', '-10']
  timeoutMs?: number;
}

// MUST use spawn/execFile — NOT exec(commandString)
// Reasons: exec passes string through /bin/sh, enabling chaining and shell injection
// spawn with explicit argv does not invoke a shell interpreter
async function shellTool(params: ShellParams, ctx: SubstrateContext): Promise<ToolResult> {
  const { executable, args, timeoutMs = 30_000 } = params;
  // 1. Classify risk level (see security package)
  // 2. If consequential: request confirmation before spawning
  // 3. spawn(executable, args, { cwd: ctx.workspaceRoot, env: sanitizedEnv })
  // 4. Emit command.executed event with exit code and duration
}
```

**What this prevents vs `exec`:**
- No shell string injection (args are array, not interpolated string)
- No operator chaining (`&&`, `||`, `;`, `|`)
- No shell builtins (`cd`, `source`, etc.)
- No implicit shell expansion (`*`, `$VAR`, backtick)

**What it does NOT prevent (Phase 1 accepted limitations, documented):**
- Sub-process spawning its own children (no OS-level process jail)
- Network access from subprocesses
- Absolute path arguments passed to the executable itself (e.g. `git -C /other/path`)

Phase 1 acceptance: classification + confirmation is the boundary. OS-level sandboxing is Phase 2.

### 3.4 Workspace Scoping
- All `read`/`patch`/`search` paths: `path.resolve(workspaceRoot, userPath)` + assert starts with `workspaceRoot`
- Symlink traversal: `fs.realpath` before assertion
- `shell`: cwd always set to `workspaceRoot`; absolute path args to high-risk executables classified as `dangerous`

**Files**: `packages/exec-substrate/src/types.ts`, `packages/exec-substrate/src/tools/read.ts`, `packages/exec-substrate/src/tools/patch.ts`, `packages/exec-substrate/src/tools/shell.ts`, `packages/exec-substrate/src/tools/search.ts`, `packages/exec-substrate/src/substrate.ts`
**Tests**: `packages/exec-substrate/src/__tests__/workspace-scope.test.ts`, `packages/exec-substrate/src/__tests__/shell.test.ts`, `packages/exec-substrate/src/__tests__/read.test.ts`, `packages/exec-substrate/src/__tests__/patch.test.ts`

---

## 4. AgentRuntime Protocol (`agent-runtime`)

### 4.1 Protocol Definition

```typescript
import type { WorkGoal, WorkSession, Action, ActionResult } from '@octopus/work-contracts';

// Session Plane: stable across all adapters
export interface SessionPlane {
  initSession(goal: WorkGoal): Promise<WorkSession>;
  pauseSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  snapshotSession(sessionId: string): Promise<SessionSnapshot>;
  getMetadata(sessionId: string): Promise<RuntimeMetadata>;
}

// Execution Plane: may vary across adapters
export interface ExecutionPlane {
  loadContext(sessionId: string, context: ContextPayload): Promise<void>;
  requestNextAction(sessionId: string): Promise<RuntimeResponse>;
  ingestToolResult(sessionId: string, actionId: string, result: ActionResult): Promise<void>;
  signalCompletion(sessionId: string, candidate: CompletionCandidate): void;
  signalBlocked(sessionId: string, reason: string): void;
}

export interface AgentRuntime extends SessionPlane, ExecutionPlane {
  readonly type: 'embedded' | 'cli' | 'acp' | 'remote';
}

export type RuntimeResponse =
  | { kind: 'action'; action: Action }
  | { kind: 'completion'; evidence: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'clarification'; question: string };
```

**Files**: `packages/agent-runtime/src/types.ts`, `packages/agent-runtime/src/protocol.ts`
**Tests**: `packages/agent-runtime/src/__tests__/protocol.test.ts` (contract / duck-type tests)

---

## 5. Embedded Runtime (`runtime-embedded`)

### 5.1 Phase 1 Implementation
- Implements `AgentRuntime` protocol
- Backed by Anthropic Claude API (configurable to OpenAI-compatible)
- Translates Work Core requests into Claude `tool_use` API calls
- Parses responses into `RuntimeResponse`
- Emits `model.call` events through event bus
- **tsup bundle** (deliverable package)

### 5.2 LLM Integration
- System prompt: WorkGoal + tool schemas + workspace context snapshot
- Tool definitions map to `exec-substrate` tools (read, patch, shell, search)
- Streaming enabled for CLI live display
- Token accounting emitted in `model.call` payload

### 5.3 Configuration
```typescript
export interface EmbeddedRuntimeConfig {
  provider: 'anthropic' | 'openai-compatible';
  model: string;            // default: 'claude-sonnet-4-6'
  apiKey: string;
  maxTokens: number;
  temperature: number;
  baseUrl?: string;         // for openai-compatible providers
}
```

**Files**: `packages/runtime-embedded/src/runtime.ts`, `packages/runtime-embedded/src/prompt-builder.ts`, `packages/runtime-embedded/src/response-parser.ts`, `packages/runtime-embedded/src/config.ts`
**Tests**: mocked LLM responses (no live API in unit tests)

---

## 6. State Store (`state-store`)

### 6.1 Storage Model
```
.octopus/
  sessions/<session-id>/session.json      # WorkSession (no items array — items stored separately)
  sessions/<session-id>/items.json        # WorkItem[]
  sessions/<session-id>/artifacts.json    # Artifact[]
  traces/<session-id>.jsonl               # managed by observability package
```

### 6.2 Interface
```typescript
import type { WorkSession, WorkItem, Artifact, SessionSummary } from '@octopus/work-contracts';

export interface StateStore {
  saveSession(session: WorkSession): Promise<void>;
  loadSession(sessionId: string): Promise<WorkSession | null>;
  listSessions(): Promise<SessionSummary[]>;
  saveArtifact(sessionId: string, artifact: Artifact): Promise<void>;
  loadArtifacts(sessionId: string): Promise<Artifact[]>;
}
```

### 6.3 Workspace Visible State Files
Written by Work Core (not state-store) to workspace root:
- `PLAN.md` — current intent and approach
- `TODO.md` — actionable next items
- `STATUS.md` — current state and unresolved questions

These are workspace-shared; one active session owns writes at a time.

**Files**: `packages/state-store/src/store.ts`, `packages/state-store/src/types.ts`
**Tests**: `packages/state-store/src/__tests__/store.test.ts`

---

## 7. Security — Safe-Local Profile (`security`)

### 7.1 Action Categories (Updated)

```typescript
import type { Action } from '@octopus/work-contracts';

export type ActionCategory =
  | 'read'          // file read, directory listing
  | 'patch'         // file write, file delete
  | 'shell'         // subprocess execution
  | 'modelApiCall'  // [NEW] LLM API outbound — privileged, observable, separate from general network
  | 'network'       // general user-side network (disabled in safe-local)
  | 'remote';       // remote attach / gateway (disabled in safe-local)

export type RiskLevel = 'safe' | 'consequential' | 'dangerous';

export interface PolicyDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  riskLevel: RiskLevel;
  reason: string;
}

export interface SecurityPolicy {
  evaluate(action: Action, category: ActionCategory): PolicyDecision;
  approveForSession(actionPattern: string): void;
}
```

### 7.2 Safe-Local Policy Matrix (Updated)

| Category | Phase 1 Default | Notes |
|----------|----------------|-------|
| `read` | Allowed | Workspace-scoped |
| `patch` | Allowed | Workspace-scoped |
| `shell` | Confirmation for consequential | Uses spawn classifier |
| `modelApiCall` | **Allowed if configured** | Explicit privileged channel; emits `model.call` event |
| `network` | Disabled | General user-side network access |
| `remote` | Disabled | Remote attach / gateway |

### 7.3 `modelApiCall` — Privileged Channel Design

The embedded runtime's outbound LLM calls are **not** classified as general `network`.

Rules:
- `modelApiCall` is enabled when the user has configured an API key and endpoint
- Every call emits a `model.call` observability event (provider, model, tokens, duration, endpoint)
- This makes it a visible, auditable, deliberately-configured channel — not hidden network access
- General `network` (user-initiated HTTP, arbitrary URL fetches) remains disabled

### 7.4 Shell Risk Classifier

```typescript
// Risk classification for spawn-based shell execution
export function classifyShellRisk(executable: string, args: string[]): RiskLevel {
  const dangerous = ['rm', 'rmdir', 'dd', 'mkfs', 'shutdown', 'reboot', 'kill', 'pkill'];
  const consequential = ['git', 'npm', 'pnpm', 'pip', 'brew', 'apt', 'curl', 'wget', 'ssh'];

  if (dangerous.includes(executable)) return 'dangerous';
  if (consequential.includes(executable)) return 'consequential';

  // Absolute path args to any executable = consequential at minimum
  if (args.some(a => path.isAbsolute(a))) return 'consequential';

  return 'safe';
}
```

### 7.5 Confirmation UX
For `consequential` or `dangerous` shell actions:
- Show: exact executable + args, cwd, risk label, reason for request
- Options: `y` (allow once) / `Y` (allow for session) / `n` (deny)
- Session-scoped approvals stored in runtime memory only (not persisted)

**Files**: `packages/security/src/policy.ts`, `packages/security/src/safe-local.ts`, `packages/security/src/classifier.ts`
**Tests**: `packages/security/src/__tests__/safe-local.test.ts`, `packages/security/src/__tests__/classifier.test.ts`

---

## 8. Work Core Engine (`work-core`)

### 8.1 Work Loop Implementation

```typescript
import type { WorkGoal, WorkSession } from '@octopus/work-contracts';
import type { AgentRuntime } from '@octopus/agent-runtime';
import type { ExecutionSubstrate } from '@octopus/exec-substrate';
import type { StateStore } from '@octopus/state-store';
import type { EventBus } from '@octopus/observability';
import type { SecurityPolicy } from '@octopus/security';

export class WorkEngine {
  constructor(
    private runtime: AgentRuntime,
    private substrate: ExecutionSubstrate,
    private stateStore: StateStore,
    private eventBus: EventBus,
    private policy: SecurityPolicy,
  ) {}

  async executeGoal(goal: WorkGoal): Promise<WorkSession> {
    // 1. Intake:   create WorkSession, emit session.started
    // 2. Scope:    runtime.loadContext with minimal workspace snapshot
    // 3. Loop:
    //    a. Form:    runtime.requestNextAction()
    //    b. Policy:  policy.evaluate(action) — confirm if required
    //    c. Execute: substrate.execute(action) — emits typed substrate event
    //    d. Ingest:  runtime.ingestToolResult(result)
    //    e. Persist: stateStore.saveSession, write PLAN/TODO/STATUS if changed
    //    f. Decide:  continue | stop | escalate | rescope
    // 4. Complete: isCompletable(evidence) check before session.completed
  }
}
```

### 8.2 Re-Entrant Loop
- One WorkGoal → multiple WorkItems (decomposed by runtime during Form phase)
- Session loops until all required WorkItems are `done` or `skipped`
- `failed` WorkItem blocks session completion until resolved or explicitly accepted
- Each iteration produces visible state updates + events

### 8.3 Planning Artifact Ownership
- One workspace, one active writing session at a time
- Shared files (`PLAN.md`, `TODO.md`, `STATUS.md`) owned by active session
- Concurrent sessions may read but not write shared artifacts

**Files**: `packages/work-core/src/engine.ts`, `packages/work-core/src/work-loop.ts`, `packages/work-core/src/decomposition.ts`, `packages/work-core/src/completion.ts`
**Tests**: `packages/work-core/src/__tests__/engine.test.ts`, `packages/work-core/src/__tests__/work-loop.test.ts`, `packages/work-core/src/__tests__/completion.test.ts`

---

## 9. CLI Surface (`surfaces-cli`)

### 9.1 Commands
| Command | Description |
|---------|-------------|
| `octopus run <goal>` | Submit a work goal and execute |
| `octopus status` | Show current/recent session state |
| `octopus sessions` | List all sessions with summaries |
| `octopus replay <session-id>` | **Read JSONL trace, re-render events** (Phase 1 scope) |
| `octopus config` | Manage API key, model, profile |

### 9.2 Live Output
- Subscribe to event bus → render events to terminal as they arrive
- `file.read` / `file.patched` → show path
- `command.executed` → show executable + args + exit code
- `model.call` → show provider + model + token count
- Color-coded by event type; `ora` spinner during runtime turns

### 9.3 Confirmation UI (safe-local)
- Blocking `inquirer` prompt triggered by security policy
- Shows: executable, args array, cwd, risk level, reason
- Choices: "Allow once" / "Allow for session" / "Deny"

### 9.4 Technology
- `commander` — CLI framework
- `chalk` — terminal colors
- `ora` — spinners
- `inquirer` — interactive prompts
- **tsup bundle** (deliverable package)

**Files**: `packages/surfaces-cli/src/cli.ts`, `packages/surfaces-cli/src/commands/run.ts`, `packages/surfaces-cli/src/commands/status.ts`, `packages/surfaces-cli/src/commands/sessions.ts`, `packages/surfaces-cli/src/commands/replay.ts`, `packages/surfaces-cli/src/renderer.ts`, `packages/surfaces-cli/src/confirmation.ts`

---

## 10. Integration & Wiring

### 10.1 Bootstrap
```
surfaces-cli
  └── WorkEngine(
        runtime: EmbeddedRuntime(config),
        substrate: ExecutionSubstrate(workspaceRoot, eventBus),
        stateStore: FileStateStore(dataDir),
        eventBus: EventBus(),
        policy: SafeLocalPolicy(confirmationUi),
      )
```

### 10.2 Configuration
- `.octopus/config.json` — API key, model, profile selection
- Environment: `OCTOPUS_API_KEY`, `OCTOPUS_MODEL`, `OCTOPUS_PROFILE`

### 10.3 Data Directory Layout
```
.octopus/
  config.json
  sessions/
    <session-id>/
      session.json
      items.json
      artifacts.json
  traces/
    <session-id>.jsonl
```

---

## Build Sequence (Dependency Order — UPDATED, DAG verified)

```
Step 0: work-contracts      — pure types, no deps                    [tsc]
Step 1: observability       — depends on work-contracts              [tsc]
Step 2: agent-runtime       — depends on work-contracts, obs         [tsc]
Step 3: exec-substrate      — depends on work-contracts, obs         [tsc]
Step 4: state-store         — depends on work-contracts              [tsc]
Step 5: security            — depends on work-contracts              [tsc]
Step 6: work-core           — depends on steps 0-5 (no cycles)      [tsc]
Step 7: runtime-embedded    — depends on agent-runtime, obs          [tsup]
Step 8: surfaces-cli        — depends on all above                   [tsup]
```

**Cycle check**: work-contracts has no deps → no cycles possible. All arrows flow from work-contracts outward.

---

## Verification Commands

```bash
# Dependency graph check (no circular deps)
pnpm exec madge --circular packages/*/src/index.ts

# Type check all packages
pnpm -r type-check

# Unit tests (all packages)
pnpm -r test

# Observability contract tests (must all pass as gate)
pnpm --filter observability test -- --grep "contract"

# Security classifier tests
pnpm --filter security test -- --grep "classifier"

# Workspace scope escape tests
pnpm --filter exec-substrate test -- --grep "workspace scope"

# CLI smoke test (end-to-end with mock runtime)
pnpm --filter surfaces-cli build
node packages/surfaces-cli/dist/cli.js run "list files in current directory"

# Verify trace file produced
ls .octopus/traces/ | head -1
cat .octopus/traces/*.jsonl | jq '.type' | sort | uniq -c
```

---

## Key Design Decisions (v2)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `work-contracts` as dep root | Breaks circular dep: types needed by agent-runtime/state-store/security before work-core logic exists |
| 2 | 9 packages total | One extra package worth it to keep DAG clean |
| 3 | `spawn`/`execFile` not `exec` | Shell string interpretation is the attack surface; argv array is not |
| 4 | `modelApiCall` as privileged channel | LLM calls are inherently networked but must be transparent; separate category preserves safe-local intent |
| 5 | 4 typed substrate events | `action.*` is too coarse; file/command/model need typed payloads for observability value |
| 6 | Contract tests as gate | Without hard enforcement, observability collapses under delivery pressure |
| 7 | tsc internal, tsup deliverables | Bundling internal packages amplifies dep boundary issues; tsc output is sufficient within monorepo |
| 8 | Phase 1 replay = JSONL only | Snapshot restore is Phase 2; JSONL replay delivers observability value with minimal complexity |
| 9 | Embedded runtime only | Arch doc §8.4: one runtime first, keep protocol seam explicit, add adapters after loop is stable |
| 10 | Evidence-based completion | Arch doc §7.7: model self-report is not completion |

---

## Risk Assessment (v2)

| Risk | Mitigation |
|------|-----------|
| LLM tool_use parsing fragility | Strict response parser + discriminated union types + fallback to `blocked` + unit tests with fixture responses |
| Workspace scope escape (file tools) | `path.realpath` + prefix assertion + symlink resolution + dedicated escape tests |
| Shell escapes via subprocess children | Accepted Phase 1 limitation; documented; OS-level sandbox deferred to Phase 2 |
| Absolute path args to executables | Classified as `consequential` by classifier; triggers confirmation |
| modelApiCall misconfigured → silent fail | Config validation at startup; clear error if API key missing |
| Event model bloat | Design gate: new events require declared type + typed payload schema + contract test |
| Phase 1 scope creep | Hard exclusions: no gateway, no MCP, no vibe/platform profiles, no snapshot restore |
