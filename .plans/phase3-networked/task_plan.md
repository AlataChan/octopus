# Phase 3 Implementation Plan: Networked & Remote

Status: v4 — Post Codex Round 3 review
Source: `docs/WORK_AGENT_ARCHITECTURE.md` + `.plans/PHASE_PLAN.md`
Scope: Phase 3 — Gateway + remote runtime + browser UI + remote operation
Prerequisite: Phase 2 complete (2026-03-18)

---

## Changelog from v1 (Codex Round 1 Review)

| # | Change | Reason |
| - | ------ | ------ |
| 1 | Added dedicated `/ws/runtime` protocol channel with typed request/response messages for full AgentRuntime proxy | v1 gateway API only defined operator-facing routes — runtime-remote could not be implemented against it |
| 2 | Banned query-param auth for tokens/keys. Browser WS uses post-connect auth message. | Query-string tokens leak into logs, browser history, diagnostics. Browser WS cannot set custom headers on upgrade. |
| 3 | Removed 3.7 (webhook source + automation daemon) from Phase 3 scope | Scope creep — not required for Phase 3 completion criteria. Webhook/daemon deferred to Phase 3.1 or Phase 4. |
| 4 | Added per-message authorization rules: attach requires `sessions.read`, control requires `sessions.control`, goal submit requires `goals.submit` | v1 was underspecified — no WS-level permission checks after initial connect |
| 5 | WS connections closed on token expiry. Origin validation for browser WS. | Long-lived WS connections could outlive token TTL without enforcement |
| 6 | Replaced `gateway start/stop` with `gateway run` (foreground only) | v1 described `gateway stop` but no daemon model was designed. Inconsistent. |
| 7 | `/api/config` now returns redacted status only — never secrets | API key, sessionTokenSecret, TLS paths must not be exposed via config endpoint |
| 8 | Ctrl+C in `remote attach` = detach (quit client). Explicit `/cancel` command for remote session cancel. | Ctrl+C → remote cancel is dangerous — users expect Ctrl+C to quit the local client |
| 9 | Added `trustProxy` config for TLS termination behind reverse proxy | Edge case: operator runs gateway behind nginx/caddy with TLS at proxy layer |

## Changelog from v2 (Codex Round 2 Review)

| # | Change | Reason |
| - | ------ | ------ |
| 10 | Added Cancel button to browser ControlBar (with confirmation dialog, via HTTP POST) | v2 browser had only pause/resume — did not satisfy "equivalent control to CLI" completion criterion |
| 11 | Clarified `runtime-remote` role: transport-parity adapter for tooling/testing only. Primary remote operator path is the operator API. Server-side is authoritative for execution, state, and policy. | v2 implied local WorkEngine could drive remote Octopus via runtime-remote, creating split-brain risk |
| 12 | WS token expiry enforced by server-side sweep timer (every 30s), not just on incoming messages | Passive event-stream clients only receive outbound events — incoming-only check lets expired tokens stream indefinitely |
| 13 | Replaced `trustProxy: boolean` with `trustProxyCIDRs: string[]` — explicit trusted proxy IP ranges | Boolean `trustProxy` is too coarse — any spoofed proxy header could bypass TLS requirement |
| 14 | Added 5-second unauthenticated WS timeout — connections that don't send auth message within 5s are closed | Without timeout, clients can open many unauthenticated sockets (resource exhaustion) |
| 15 | Defined `POST /api/goals` response contract: `{ sessionId, goalId, state }` | `remote run` depends on sessionId from goal submission — response shape was unspecified |

## Changelog from v3 (Codex Round 3 Review)

| # | Change | Reason |
| - | ------ | ------ |
| 16 | Added remote approval/rejection flow: `POST /api/sessions/:id/approval`, WS `approval.requested` notification, browser `ApprovalDialog`, CLI remote prompt. New permission `sessions.approve`. | Remote operator cannot handle safe-local confirmation prompts — browser/CLI equivalence incomplete without it |
| 17 | `runtime.proxy` permission is now **disabled by default**, not in `defaultPermissions`. Requires explicit `enableRuntimeProxy: true` in gateway config to activate. | `runtime.proxy` exposes a sharper internal protocol than operator API — should not be available by default to prevent blast radius on credential leak |
| 18 | Added request-time trusted-proxy TLS-header validation: `X-Forwarded-Proto: https` only honored when socket remote address is in `trustProxyCIDRs`. All other peers treat as direct plaintext. | Startup CIDR check alone is insufficient — spoofed forwarded headers from non-trusted peers could bypass TLS enforcement |
| 19 | Terminology cleanup pass: browser mock shows Cancel button, all references to `trustProxy` updated to `trustProxyCIDRs`, token expiry text reflects sweep timer model |

---

## Phase 3 Theme

> Expose the core over network protocols without changing its semantics.

Phase 2 proved the core is reliable and event-driven. Phase 3 makes it remotely accessible — without redefining what it is.

**Target user**: Operator accessing a local or cloud-hosted agent remotely; or building tooling on top.

**Iron rule (inherited)**: Nothing in Phase 3 redefines Phase 1/2 semantics. Gateway is transport, not ontology. Local operation must never require gateway.

---

## Key Design Decisions

| Question | Decision | Rationale |
| -------- | -------- | --------- |
| Auth model | API key (default) + opaque session token (upgrade) | Simple default for single-operator; session token for browser/WS. JWT deferred — stateless verification unnecessary for single-gateway. Reviewed with Codex. |
| Runtime adapter | `runtime-remote` (not ACP) | Serves actual Phase 3 user (remote operator). ACP spec still evolving. `runtime-remote` validates the AgentRuntime abstraction across network boundary. ACP deferred to Phase 4. Reviewed with Codex. |
| Browser UI stack | Preact + Vite | Smallest real component model. No router, no state library, no UI kit. Session viewer + control panel, not a full app. Reviewed with Codex. |
| Remote attach UX | CLI (`remote sessions/attach/run`) + Browser UI | Both thin surfaces over same gateway API. CLI for SSH operators, browser for visual monitoring. Reviewed with Codex. |
| Gateway transport | HTTP + WebSocket (two WS channels) | HTTP for request/response. `/ws/sessions/:id/events` for operator event stream. `/ws/runtime` for full AgentRuntime protocol proxy. No RPC framework. |
| Token transport | Never in query params. HTTP: `X-API-Key` or `Authorization: Bearer`. WS: post-connect `auth` message. | Query-param tokens leak into logs/history/diagnostics. Browser WS cannot set custom headers. |
| Reattach semantics | Reconnect streams from "now" + recent-event backfill buffer | Client disconnect does not affect session. Reattach gets small backfill (last N events) + live stream. |
| Control collision | Idempotent controls | pause/cancel/resume are safe to repeat from multiple attached clients. No ownership transfer on attach. |
| TLS requirement | Required for non-loopback (with `trustProxyCIDRs` escape) | Bearer auth over plaintext is unacceptable for remote exposure. Loopback exempt for local dev. Reverse proxy TLS supported via explicit trusted proxy CIDRs. |
| Detach vs cancel | Ctrl+C = detach (quit client). Explicit command for remote cancel. | Users expect Ctrl+C to exit the local process, not kill a remote session. |
| runtime-remote role | Transport-parity adapter for tooling/testing. NOT the primary remote operator path. | Server-side is authoritative for execution, state, and policy. remote-operator uses operator API (HTTP + WS events). runtime-remote proves AgentRuntime works across network boundary. |
| WS auth timeout | 5-second deadline after WS upgrade for auth message | Without timeout, unauthenticated connections accumulate (resource exhaustion vector). |

---

## Deliverables Overview

| # | Deliverable | Packages Affected | Priority |
| - | ----------- | ----------------- | -------- |
| 3.1 | Observability: gateway + remote event types | `observability` (update) | P0 (do first) |
| 3.2 | Gateway core (HTTP + WS + auth + runtime protocol) | `gateway` (new) | P0 |
| 3.3 | Runtime Remote adapter | `runtime-remote` (new) | P0 |
| 3.4 | Browser UI | `surfaces-web` (new) | P1 |
| 3.5 | CLI remote commands | `surfaces-cli` (update) | P1 |
| 3.6 | Security: remote access controls | `security` (update) | P0 |

**Build sequence**: 3.1 (observability) → 3.6 (security) → 3.2 (gateway) → 3.3 (runtime-remote) → 3.4 (browser UI) → 3.5 (CLI remote)

---

## 3.1 Observability: New Event Types (gate for everything else)

**Package**: `observability/src/types.ts`

```typescript
// Group G: Gateway lifecycle
export type GatewayEventType =
  | "gateway.started"       // { port, host, tlsEnabled }
  | "gateway.stopped"       // { reason }
  | "gateway.client.connected"    // { clientId, authMethod: 'api-key' | 'session-token' }
  | "gateway.client.disconnected" // { clientId, reason }
  | "gateway.auth.failed";  // { clientId, method, reason }

// Group H: Remote session operations
export type RemoteSessionEventType =
  | "remote.session.attached"   // { clientId, sessionId, mode: 'observe' | 'control' }
  | "remote.session.detached"   // { clientId, sessionId, reason }
  | "remote.goal.submitted"     // { clientId, goalId, description }
  | "remote.approval.requested" // v4: { sessionId, promptId, description, riskLevel }
  | "remote.approval.resolved"; // v4: { sessionId, promptId, action: 'approve' | 'deny', clientId }
```

Typed payloads added to `EventPayloadByType` for all 10 new event types (5 gateway lifecycle + 5 remote session operations). No `Record<string, unknown>` escape.

**Files changed**: `packages/observability/src/types.ts`, `packages/observability/src/__tests__/contract.test.ts`

---

## 3.2 Gateway Core (`gateway` — new package)

### Architecture

The gateway is a thin HTTP + WebSocket server that wraps existing Work Core, StateStore, and EventBus interfaces. It does NOT own any work semantics.

Gateway exposes **two distinct API surfaces**:

1. **Operator API** — HTTP + WS event stream for session monitoring and control
2. **Runtime Protocol** — WS channel for full AgentRuntime proxy (used by `runtime-remote`)

```
Operator (CLI/Browser) → [HTTP + /ws/sessions/:id/events] → Operator API → StateStore / EventBus
Remote WorkEngine      → [/ws/runtime]                     → Runtime Protocol → EmbeddedRuntime
                                       ↓
                                 Auth Middleware
                                       ↓
                                 OperatorContext
```

### Auth model

```typescript
// packages/gateway/src/auth.ts

export interface OperatorContext {
  operatorId: string;
  permissions: GatewayPermission[];
  authMethod: "api-key" | "session-token";
}

export type GatewayPermission =
  | "sessions.list"
  | "sessions.read"
  | "sessions.control"   // pause, cancel, resume
  | "sessions.approve"   // v4: approve/deny safe-local confirmation prompts
  | "goals.submit"       // create new goals remotely
  | "runtime.proxy"      // full AgentRuntime proxy access — DISABLED by default (v4)
  | "config.read";

export interface GatewayAuthConfig {
  apiKey: string;                       // required — static operator key
  sessionTokenTtlMs?: number;           // default: 3600000 (1 hour)
  defaultPermissions: GatewayPermission[];  // v4: MUST NOT include 'runtime.proxy' by default
  enableRuntimeProxy?: boolean;         // v4: default false — explicitly opt-in to expose /ws/runtime
}
```

**API key flow (HTTP only)**: Client sends `X-API-Key` header → constant-time comparison → resolve to `OperatorContext` with `defaultPermissions`.

**Session token flow (for browser + WS)**:
1. `POST /auth/token` with `X-API-Key` header
2. Gateway mints opaque token (random UUID), stores in memory Map with `{ operatorId, permissions, expiresAt }`
3. Client uses `Authorization: Bearer <token>` for subsequent HTTP requests
4. Token validated via Map lookup (not JWT — single process, no stateless verification needed)

**WS auth flow (v2 — post-connect message, not query params)**:
1. Client opens WS connection (no auth on upgrade — just a raw TCP+WS handshake)
2. Client sends first message: `{ type: "auth", token: "<session-token>" }` or `{ type: "auth", apiKey: "<key>" }`
3. Gateway validates and binds `OperatorContext` to this connection
4. If auth fails → gateway sends `{ type: "auth.failed", reason: "..." }` and closes connection
5. All subsequent messages require valid `OperatorContext` — unauthenticated messages are rejected

**Unauthenticated WS timeout (v3)**: After WS upgrade, client has **5 seconds** to send the `auth` message. If no auth message received within 5s → gateway closes the connection with `{ type: "auth.timeout" }`. This prevents unauthenticated socket accumulation.

**Token expiry on long-lived WS connections (v3 — server-side sweep)**:
- Gateway runs a **sweep timer every 30 seconds** that checks all active WS connections
- If a connection's token has expired → gateway sends `{ type: "auth.expired" }` and closes the connection
- This covers both active (sending messages) and passive (receiving events only) connections
- Additionally, incoming messages are still checked for token expiry as an immediate rejection path
- Client must reconnect and re-authenticate

**Browser Origin validation**: Gateway checks `Origin` header on WS upgrade. If `host` is not loopback, Origin must match configured allowed origins (default: same origin only).

### Per-message authorization (v2)

Every WS and HTTP operation checks the required permission:

| Operation | Required Permission | Notes |
| --------- | ------------------- | ----- |
| List sessions | `sessions.list` | |
| Read session detail / events | `sessions.read` | |
| Attach to event stream (WS) | `sessions.read` | |
| Send pause/cancel/resume | `sessions.control` | |
| Approve/deny confirmation prompt | `sessions.approve` | v4: safe-local remote approval |
| Submit new goal | `goals.submit` | |
| Runtime protocol messages | `runtime.proxy` | v4: requires `enableRuntimeProxy: true` in config |
| Read config status | `config.read` | |

**`runtime.proxy` fencing (v4)**: The `/ws/runtime` endpoint is only accessible when `enableRuntimeProxy: true` is set in gateway config. If disabled (default), any connection to `/ws/runtime` receives `{ type: "error", reason: "Runtime proxy not enabled" }` and is closed. Even when enabled, only tokens with explicit `runtime.proxy` permission can use it. This permission MUST NOT be included in `defaultPermissions`.

### Operator HTTP API

```
GET    /api/sessions                    → SessionSummary[]
GET    /api/sessions/:id                → WorkSession
GET    /api/sessions/:id/snapshots      → SnapshotSummary[]
GET    /api/sessions/:id/events         → WorkEvent[]
POST   /api/goals                       → { sessionId, goalId, state }     (v3: response defined)
         Body: { description, constraints?, namedGoalId? }
POST   /api/sessions/:id/control        → { ok: true }
         Body: { action: 'pause' | 'cancel' | 'resume' }
POST   /api/sessions/:id/approval       → { ok: true }                     (v4: new)
         Body: { promptId, action: 'approve' | 'deny' }
GET    /api/status                      → redacted config status (v2)
POST   /auth/token                      → { token, expiresAt }
GET    /health                          → { status: 'ok', uptime, sessions }
```

**`POST /api/goals` response contract (v3)**:

```typescript
interface GoalSubmissionResponse {
  sessionId: string;    // the created session ID — used by `remote run` to auto-attach
  goalId: string;       // the goal ID
  state: SessionState;  // always "created" on initial submission
}
```

**`/api/status` redaction rules (v2)**: Returns non-secret status only:

```typescript
{
  profile: "platform",
  apiKeyConfigured: true,          // boolean, never the actual key
  tlsEnabled: true,
  trustProxyCIDRs: [],
  host: "0.0.0.0",
  port: 4321,
  allowRemote: true,
  activeSessionCount: 3,
  connectedClients: 2
}
```

Never returns: `apiKey`, `sessionTokenSecret`, TLS cert/key paths, policy file contents.

### Operator WS API (event stream)

```
WS /ws/sessions/:id/events         → live event stream (bidirectional)
   → First message from client: { type: "auth", token: "<token>" }
   ← Server: { type: "auth.ok" }
   ← Server: { type: "backfill", events: WorkEvent[] }   // last 50 events
   ← Server: WorkEvent (live stream from EventBus)
   → Client: { type: "control", action: "pause" | "resume" }
   ← Server: { type: "approval.requested", promptId, description, riskLevel }  (v4: new)
```

**Remote approval flow (v4)**: When a session blocks for safe-local confirmation (e.g., a shell command requiring operator approval), the gateway emits an `approval.requested` message to all attached WS clients. The operator responds via HTTP `POST /api/sessions/:id/approval { promptId, action: 'approve' | 'deny' }`. This keeps the approval path explicit (HTTP, not WS fire-and-forget) and auditable.

**Note (v2)**: `cancel` is NOT available via the operator event stream WS. Cancel requires explicit HTTP `POST /api/sessions/:id/control { action: 'cancel' }`. This prevents accidental cancellation from keyboard shortcuts in the stream viewer. Both CLI and browser UI use this HTTP endpoint for cancel.

### Runtime Protocol WS (v2 — new, for runtime-remote)

A dedicated WS channel that exposes the full `AgentRuntime` interface as typed request/response messages.

```
WS /ws/runtime                     → full AgentRuntime proxy (bidirectional)
   → First message: { type: "auth", token: "<token>" }    // requires runtime.proxy permission
   ← Server: { type: "auth.ok" }

   // SessionPlane operations (request/response)
   → { type: "runtime.initSession", requestId, goal }
   ← { type: "runtime.initSession.result", requestId, session }

   → { type: "runtime.pauseSession", requestId, sessionId }
   ← { type: "runtime.pauseSession.result", requestId }

   → { type: "runtime.resumeSession", requestId, sessionId }
   ← { type: "runtime.resumeSession.result", requestId }

   → { type: "runtime.cancelSession", requestId, sessionId }
   ← { type: "runtime.cancelSession.result", requestId }

   → { type: "runtime.snapshotSession", requestId, sessionId }
   ← { type: "runtime.snapshotSession.result", requestId, snapshot }

   → { type: "runtime.hydrateSession", requestId, snapshot }
   ← { type: "runtime.hydrateSession.result", requestId, session }

   → { type: "runtime.getMetadata", requestId, sessionId }
   ← { type: "runtime.getMetadata.result", requestId, metadata }

   // ExecutionPlane operations (request/response)
   → { type: "runtime.loadContext", requestId, sessionId, context }
   ← { type: "runtime.loadContext.result", requestId }

   → { type: "runtime.requestNextAction", requestId, sessionId }
   ← { type: "runtime.requestNextAction.result", requestId, response: RuntimeResponse }

   → { type: "runtime.ingestToolResult", requestId, sessionId, actionId, result }
   ← { type: "runtime.ingestToolResult.result", requestId }

   → { type: "runtime.signalCompletion", sessionId, candidate }    // fire-and-forget (void)
   → { type: "runtime.signalBlocked", sessionId, reason }          // fire-and-forget (void)

   // Error response for any request
   ← { type: "runtime.error", requestId, error: string }
```

Each request carries a client-generated `requestId` (UUID). Server matches responses to requests via `requestId`. This keeps the protocol stateless per-message and allows concurrent requests.

**Server-side implementation**: Gateway dispatches WS messages to the actual `AgentRuntime` (EmbeddedRuntime) methods and returns results. All policy enforcement happens inside the runtime — gateway is a transparent relay.

### TLS enforcement (v3 — with trustProxyCIDRs)

```typescript
// packages/gateway/src/server.ts

export interface GatewayConfig {
  port: number;                         // default: 4321
  host: string;                         // default: '127.0.0.1' (loopback only)
  tls?: {
    cert: string;                       // path to cert file
    key: string;                        // path to key file
  };
  trustProxyCIDRs?: string[];           // v3: explicit trusted proxy IP ranges (e.g. ["10.0.0.0/8", "172.16.0.1/32"])
  auth: GatewayAuthConfig;
  backfillEventCount?: number;          // default: 50
  wsAuthTimeoutMs?: number;             // v3: default 5000 — unauthenticated WS connection deadline
  tokenSweepIntervalMs?: number;        // v3: default 30000 — expired token sweep interval
  allowedOrigins?: string[];            // for browser WS Origin validation (default: same-origin only)
}
```

**TLS rule (v3)**: If `host` is not loopback AND `tls` is not configured AND request source IP is not in `trustProxyCIDRs` → fail fast:

```
Error: TLS required for non-loopback gateway exposure.
       Options:
         1. Set host to 127.0.0.1 for local use
         2. Provide tls.cert and tls.key for direct TLS
         3. Set trustProxyCIDRs to trusted reverse proxy IP ranges
            (only if TLS is terminated at the proxy)
```

**`trustProxyCIDRs` security model (v3/v4)**:

Unlike a bare `trustProxy: boolean`, this requires the operator to explicitly declare which IP ranges are trusted reverse proxies. If `trustProxyCIDRs` is empty or unset, the proxy escape is disabled.

**Startup-time gate**: If `host` is non-loopback AND `tls` is not configured AND `trustProxyCIDRs` is empty → fail fast.

**Request-time transport guard (v4)**: On every incoming HTTP request and WS upgrade:

```typescript
function isSecureConnection(req: IncomingMessage, config: GatewayConfig): boolean {
  // Direct TLS — always secure
  if (config.tls) return true;

  // Loopback — always secure
  if (isLoopback(req.socket.remoteAddress)) return true;

  // Trusted proxy — only honor X-Forwarded-Proto from trusted source IPs
  if (config.trustProxyCIDRs?.length) {
    const remoteAddr = req.socket.remoteAddress;
    if (isInCIDRRange(remoteAddr, config.trustProxyCIDRs)) {
      return req.headers["x-forwarded-proto"] === "https";
    }
  }

  // All other peers — treated as direct plaintext, rejected for non-loopback
  return false;
}
```

This ensures `X-Forwarded-Proto: https` is only honored when the socket remote address is within `trustProxyCIDRs`. Peers not in the trusted range cannot spoof TLS assertions.

### Gateway server lifecycle

```typescript
// packages/gateway/src/server.ts

export class GatewayServer {
  constructor(
    private config: GatewayConfig,
    private engine: WorkEngine,
    private runtime: AgentRuntime,       // v2: gateway needs runtime ref for runtime protocol
    private store: StateStore,
    private eventBus: EventBus,
    private policy: SecurityPolicy,
  ) {}

  async start(): Promise<void>    // bind HTTP + WS, emit gateway.started
  async stop(): Promise<void>     // close all connections, emit gateway.stopped
}
```

The gateway receives pre-assembled dependencies — it does NOT assemble them. Assembly stays in the factory layer (`createGatewayApp()` in surfaces-cli).

### Package structure

```text
packages/gateway/
  src/
    types.ts              # GatewayConfig, OperatorContext, GatewayPermission
    auth.ts               # API key validation, session token mint/validate/expiry
    server.ts             # GatewayServer (HTTP + WS)
    routes/
      sessions.ts         # session list/detail/snapshots/events routes
      goals.ts            # goal submission route
      control.ts          # session control route (pause/cancel/resume)
      approval.ts         # v4: session approval route (approve/deny confirmation prompts)
      status.ts           # redacted config status route (v2: renamed from config.ts)
      health.ts           # health check route
      auth-routes.ts      # POST /auth/token
    ws/
      event-stream.ts     # /ws/sessions/:id/events — operator event streaming + backfill
      runtime-protocol.ts # /ws/runtime — full AgentRuntime proxy (v2: new)
    middleware/
      auth-middleware.ts   # extract + validate credentials → OperatorContext
      tls-guard.ts        # enforce TLS for non-loopback
      origin-guard.ts     # v2: validate WS Origin header
    index.ts
  __tests__/
    auth.test.ts
    server.test.ts
    routes/
      sessions.test.ts
      goals.test.ts
      control.test.ts
      approval.test.ts    # v4: new
      status.test.ts
    ws/
      event-stream.test.ts
      runtime-protocol.test.ts    # v2: new
    middleware/
      origin-guard.test.ts        # v2: new
  package.json
  tsconfig.json
```

**Dependencies**: `work-contracts`, `agent-runtime`, `work-core`, `state-store`, `observability`, `security`
**External**: Node.js built-in `http`/`https`, `ws` (WebSocket library)
**Build**: tsc

---

## 3.3 Runtime Remote Adapter (`runtime-remote` — new package)

### Purpose and role clarification (v3)

`runtime-remote` is a **transport-parity adapter** — it proves that the `AgentRuntime` interface works correctly across a network boundary. It is NOT the primary remote operator path.

**Two distinct remote use cases**:

| Use case | Path | Primary? |
| -------- | ---- | -------- |
| **Remote operator** (view sessions, control, submit goals) | Operator API: HTTP + `/ws/sessions/:id/events` | Yes — this is what most remote users use |
| **Remote runtime composition** (external tooling/testing drives the AgentRuntime protocol) | `/ws/runtime` via `RemoteRuntime` | No — advanced use for tooling and contract validation |

**Authority model**: The server side is always authoritative. Execution, state persistence, and policy enforcement all happen on the server (gateway + EmbeddedRuntime + StateStore + SecurityPolicy). `RemoteRuntime` is a transparent proxy — it does not replicate, cache, or override any server-side state. There is no split-brain risk because there is no local state.

```
External Tooling → RemoteRuntime → [/ws/runtime] → Gateway → EmbeddedRuntime (authoritative)
```

**Phase 3 delivery independence (v3)**: The remote operator path (deliverables 3.4 + 3.5) can ship independently of full `runtime-remote` (deliverable 3.3) if `runtime-remote` proves to be the technical-risk center. The operator API is self-contained and does not depend on `/ws/runtime`.

### Implementation (v2 — uses runtime protocol, not REST)

```typescript
// packages/runtime-remote/src/runtime.ts

export interface RemoteRuntimeConfig {
  gatewayUrl: string;           // e.g. "https://host:4321"
  apiKey?: string;              // used via WS post-connect auth message (no pre-minting needed)
  sessionToken?: string;        // for direct session token auth
  connectTimeoutMs?: number;    // default: 10000
  requestTimeoutMs?: number;    // default: 30000
}

export class RemoteRuntime implements AgentRuntime {
  readonly type = "remote";

  constructor(private config: RemoteRuntimeConfig) {}

  // All methods proxy via /ws/runtime typed messages
  // Each call:
  //   1. Send { type: "runtime.<method>", requestId: uuid(), ...args }
  //   2. Wait for { type: "runtime.<method>.result", requestId } or { type: "runtime.error", requestId }
  //   3. Return result or throw error

  async initSession(goal: WorkGoal): Promise<WorkSession> {
    return this.request("runtime.initSession", { goal });
  }
  async pauseSession(sessionId: string): Promise<void> {
    await this.request("runtime.pauseSession", { sessionId });
  }
  async resumeSession(sessionId: string): Promise<void> {
    await this.request("runtime.resumeSession", { sessionId });
  }
  async cancelSession(sessionId: string): Promise<void> {
    await this.request("runtime.cancelSession", { sessionId });
  }
  async snapshotSession(sessionId: string): Promise<SessionSnapshot> {
    return this.request("runtime.snapshotSession", { sessionId });
  }
  async hydrateSession(snapshot: SessionSnapshot): Promise<WorkSession> {
    return this.request("runtime.hydrateSession", { snapshot });
  }
  async getMetadata(sessionId: string): Promise<RuntimeMetadata> {
    return this.request("runtime.getMetadata", { sessionId });
  }
  async loadContext(sessionId: string, context: ContextPayload): Promise<void> {
    await this.request("runtime.loadContext", { sessionId, context });
  }
  async requestNextAction(sessionId: string): Promise<RuntimeResponse> {
    return this.request("runtime.requestNextAction", { sessionId });
  }
  async ingestToolResult(sessionId: string, actionId: string, result: ActionResult): Promise<void> {
    await this.request("runtime.ingestToolResult", { sessionId, actionId, result });
  }
  signalCompletion(sessionId: string, candidate: CompletionCandidate): void {
    this.send("runtime.signalCompletion", { sessionId, candidate });  // fire-and-forget
  }
  signalBlocked(sessionId: string, reason: string): void {
    this.send("runtime.signalBlocked", { sessionId, reason });  // fire-and-forget
  }

  // Internal helpers
  private async request<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    const requestId = randomUUID();
    this.ws.send(JSON.stringify({ type, requestId, ...payload }));
    return this.waitForResponse<T>(requestId);
  }
  private send(type: string, payload: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ type, ...payload }));
  }
  private waitForResponse<T>(requestId: string): Promise<T> {
    // Returns a Promise that resolves when matching requestId response arrives
    // Rejects on timeout or runtime.error response
  }
}
```

**Important**: All policy enforcement stays on the server (gateway + embedded runtime). RemoteRuntime is a transparent proxy — it does not make security decisions.

### Contract test parity (v2 — narrowed scope)

Shared `AgentRuntime` contract test suite covers **AgentRuntime-visible semantics only** — no transport-specific concerns:

```typescript
// packages/agent-runtime/src/__tests__/runtime-contract.ts
export function runtimeContractSuite(
  createRuntime: () => Promise<AgentRuntime>,
  cleanup: () => Promise<void>
): void {
  // Tests: initSession returns valid WorkSession
  // Tests: pauseSession/resumeSession state transitions
  // Tests: snapshotSession round-trip via hydrateSession
  // Tests: requestNextAction returns valid RuntimeResponse
  // Tests: ingestToolResult followed by requestNextAction reflects result
  // Does NOT test: reconnect, timeout, backfill, WS-specific errors
}
```

**Transport-specific tests** live in `runtime-remote/__tests__/transport.test.ts`:
- Reconnect after disconnect
- Request timeout handling
- Auth expiry during long-running request
- Concurrent request ordering

Both `runtime-embedded` and `runtime-remote` import and run the shared contract suite. `runtime-remote` tests run against a local gateway test fixture.

### Package structure

```text
packages/runtime-remote/
  src/
    types.ts              # RemoteRuntimeConfig
    runtime.ts            # RemoteRuntime implements AgentRuntime
    ws-client.ts          # WS connection manager with auth + reconnect
    index.ts
  __tests__/
    runtime.test.ts       # uses shared contract suite against local gateway fixture
    transport.test.ts     # transport-specific: reconnect, timeout, auth expiry
  package.json
  tsconfig.json
```

**Dependencies**: `agent-runtime`, `work-contracts`
**External**: `ws` (WebSocket client)
**Build**: tsc

---

## 3.4 Browser UI (`surfaces-web` — new package)

### Scope

A minimal operator dashboard. Session viewer + control panel. NOT a full web application.

### Tech stack

- **Preact** (3KB) — React-API-compatible component model
- **Vite** — build + dev server
- **No router** — single page with conditional panels
- **No state library** — local component state + props
- **No UI kit** — minimal CSS, functional styling
- **No SSR** — pure client-side SPA

### Page structure

```
+--------------------------------------------------+
|  Octopus — [Connected]              [Settings]    |
+--------------------------------------------------+
|              |                                     |
| Session List | Session Detail                      |
|              |                                     |
| * active     | State: active                       |
|   session-1  | Goal: "Generate report..."          |
|              | Items: [3/5 done]                    |
| o completed  |                                     |
|   session-2  | Live Events                         |
|              | +-------------------------------+    |
| o blocked    | | 14:30:01 file.read src/main  |    |
|   session-3  | | 14:30:02 command.executed npm |    |
|              | | 14:30:05 artifact.emitted ... |    |
|              | +-------------------------------+    |
|              |                                     |
|              | [Pause] [Resume] [Cancel]            |
+--------------------------------------------------+
```

### Components

```
App
+-- LoginForm              # API key input → mint session token
+-- ConnectionStatus       # gateway connection indicator
+-- SessionList            # fetches session list, selectable
+-- SessionDetail          # shows selected session state
|   +-- SessionHeader      # state badge, goal description, timestamps
|   +-- WorkItemList       # items with state indicators
|   +-- ArtifactList       # session artifacts
|   +-- EventStream        # live WS event viewer (scrolling log)
|   +-- ControlBar         # pause/resume/cancel buttons (v3: cancel with confirmation dialog)
|   +-- ApprovalDialog     # v4: popup when approval.requested received — approve/deny buttons
+-- StatusPanel            # read-only gateway status view (replaces ConfigPanel)
```

### Gateway integration

- **Auth (v2)**: LoginForm collects API key → `POST /auth/token` → store session token in memory only
- **Initial load**: `GET /api/sessions` → populate SessionList
- **Session detail**: `GET /api/sessions/:id` → populate SessionDetail
- **Live events**: `WS /ws/sessions/:id/events` → post-connect auth message → backfill → live stream
- **Control**: `POST /api/sessions/:id/control` via ControlBar buttons (HTTP, not WS). Cancel shows browser `confirm()` dialog before sending (v3 — prevents accidental cancellation).

### Security (v2 — tightened)

- **No query-param auth** — API key entered via LoginForm only, never in URL
- Session token stored in JS variable only — not localStorage, not cookies, not URL
- All event content rendered as **text nodes** (never `innerHTML`) — prevents XSS from trace data
- No external CDN dependencies — all assets bundled and served by gateway
- LoginForm clears API key from memory after token mint succeeds

### Package structure

```text
packages/surfaces-web/
  src/
    main.tsx              # entry point, Preact render
    App.tsx               # top-level layout
    components/
      LoginForm.tsx       # v2: API key input form
      ConnectionStatus.tsx
      SessionList.tsx
      SessionDetail.tsx
      EventStream.tsx
      ControlBar.tsx
      ApprovalDialog.tsx  # v4: approve/deny confirmation prompts
      StatusPanel.tsx     # v2: renamed from ConfigPanel, shows redacted status
    api/
      client.ts           # HTTP + WS client for gateway
      auth.ts             # token management (memory only)
    styles/
      index.css           # minimal functional CSS
    index.html            # SPA shell
  __tests__/
    components/
      SessionList.test.tsx
      EventStream.test.tsx
      ControlBar.test.tsx
      ApprovalDialog.test.tsx  # v4: new
      LoginForm.test.tsx       # v2: new
  package.json
  tsconfig.json
  vite.config.ts
```

**Dependencies**: `preact`, `vite`
**Build**: vite build → static files served by gateway

---

## 3.5 CLI Remote Commands (`surfaces-cli` — update)

### New commands (v2 — simplified)

```text
octopus remote sessions <url>                        # list remote sessions
octopus remote attach <url> <sessionId>              # stream events + control
octopus remote run <url> "<goal>"                    # submit goal + auto-attach
octopus gateway run                                  # start gateway (foreground, blocks until signal)
```

### `remote sessions`

```typescript
// Authenticate via API key (from config or --api-key flag)
// GET <url>/api/sessions
// Print session list to stdout (same format as local `octopus sessions`)
```

### `remote attach` (v2 — detach vs cancel)

```typescript
// 1. Authenticate → obtain session token (POST <url>/auth/token)
// 2. WS connect to <url>/ws/sessions/:id/events
// 3. Send post-connect auth message: { type: "auth", token }
// 4. Receive backfill events → print to stdout
// 5. Stream live events → print to stdout (same format as local run output)
// 6. Keyboard control:
//    - Ctrl+P → POST /api/sessions/:id/control { action: 'pause' }
//    - Ctrl+R → POST /api/sessions/:id/control { action: 'resume' }
//    - Type "/cancel" + Enter → POST /api/sessions/:id/control { action: 'cancel' }
//    - Ctrl+C → detach (close WS, quit client) — does NOT cancel remote session
// 7. Approval prompts (v4):
//    - On WS { type: "approval.requested", promptId, description, riskLevel }
//    - Print prompt to terminal: "[APPROVAL] <description> (risk: <riskLevel>) [y/n]?"
//    - User types "y" → POST /api/sessions/:id/approval { promptId, action: 'approve' }
//    - User types "n" → POST /api/sessions/:id/approval { promptId, action: 'deny' }
// 7. On WS close → print disconnect reason, exit
```

### `remote run`

```typescript
// 1. Authenticate via API key
// 2. POST <url>/api/goals { description }
// 3. Auto-attach to the created session (same as `remote attach`)
// 4. Stream events until session completes or user Ctrl+C (detach)
```

### `gateway run` (v2 — foreground only, renamed from `gateway start`)

```typescript
// 1. Load config (gateway section from config file)
// 2. Validate profile (safe-local rejected, vibe forced loopback, platform requires allowRemote)
// 3. Assemble dependencies (same factory as local, plus gateway)
// 4. Start GatewayServer
// 5. Block until SIGINT/SIGTERM
// 6. On signal: stop gateway, flush traces, exit
```

### Config additions

```json
// ~/.octopus/config.json — new gateway section
{
  "gateway": {
    "port": 4321,
    "host": "127.0.0.1",
    "apiKey": "<operator-generated-key>",
    "trustProxyCIDRs": [],
    "tls": {
      "cert": "/path/to/cert.pem",
      "key": "/path/to/key.pem"
    }
  }
}
```

```text
octopus config set gateway.port 4321
octopus config set gateway.apiKey <key>
octopus config set gateway.host 0.0.0.0             # requires TLS or trustProxyCIDRs
octopus config set gateway.trustProxyCIDRs 10.0.0.0/8,172.16.0.1/32
```

**Files changed**:

- `packages/surfaces-cli/src/cli.ts` — add `remote` + `gateway` command groups
- `packages/surfaces-cli/src/factory.ts` — add `createGatewayApp()` factory
- `packages/surfaces-cli/src/remote-client.ts` (new) — HTTP + WS client for remote commands
- `packages/surfaces-cli/package.json` — add `gateway` dependency

---

## 3.6 Security: Remote Access Controls (`security` — update)

### `allowRemote` enforcement

The `platform` profile's `PolicyResolution` already includes `allowRemote: boolean`. Phase 3 activates it:

```typescript
// packages/security/src/policy.ts — no structural change needed
export interface PolicyResolution {
  profile: SecurityProfileName;
  source: PolicyResolutionSource;
  policyFilePath?: string;
  allowedExecutables?: string[];
  allowNetwork?: boolean;
  allowRemote?: boolean;          // Phase 3: gateway checks this before starting
  defaultDeny: boolean;
}
```

### Profile → gateway rules

| Profile | Gateway allowed? | Rule |
| ------- | ---------------- | ---- |
| `safe-local` | No | Gateway refuses to start. Error: "Gateway requires 'vibe' or 'platform' profile." |
| `vibe` | Yes, loopback only | `host` forced to `127.0.0.1` regardless of config. Warning if non-loopback requested. |
| `platform` | Yes, any host | Full config respected. TLS required for non-loopback (unless source IP in `trustProxyCIDRs`). `allowRemote` must be `true` in policy file. |

### Gateway startup validation

```typescript
// packages/gateway/src/server.ts — in start()
function validateGatewayProfile(
  profile: SecurityProfileName,
  config: GatewayConfig,
  resolution: PolicyResolution
): void {
  if (profile === "safe-local") {
    throw new Error(
      "Gateway requires 'vibe' or 'platform' profile.\nUse: octopus gateway run --profile vibe"
    );
  }
  if (profile === "vibe" && !isLoopback(config.host)) {
    console.warn("Warning: vibe profile forces gateway to loopback. Ignoring host config.");
    config.host = "127.0.0.1";
  }
  if (profile === "platform" && !resolution.allowRemote) {
    throw new Error(
      "Gateway with platform profile requires allowRemote: true in policy file."
    );
  }
  // v3: TLS check uses trustProxyCIDRs instead of boolean
  if (!isLoopback(config.host) && !config.tls && !(config.trustProxyCIDRs?.length)) {
    throw new Error(
      "TLS required for non-loopback gateway exposure.\n" +
      "Options:\n" +
      "  1. Set host to 127.0.0.1 for local use\n" +
      "  2. Provide tls.cert and tls.key for direct TLS\n" +
      "  3. Set trustProxyCIDRs to trusted reverse proxy IP ranges"
    );
  }
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
```

**Files changed**:

- `packages/security/src/policy.ts` — no change needed (allowRemote already defined)
- `packages/gateway/src/server.ts` — profile validation on startup

---

## Build Sequence

```text
Step 0: Update observability           — 10 new event types (GatewayEventType,          [tsc]
                                         RemoteSessionEventType incl. approval) + typed payloads
Step 1: Update security                — gateway profile validation rules                [tsc]
                                         (validation logic lives in gateway, but types
                                         and rules defined here)
Step 2: New gateway package            — GatewayServer, auth (API key + session token),  [tsc]
                                         Operator HTTP API, /ws/sessions/:id/events,
                                         /ws/runtime protocol, TLS guard, Origin guard,
                                         per-message authorization, profile enforcement
Step 3: New runtime-remote package     — RemoteRuntime implements AgentRuntime via        [tsc]
                                         /ws/runtime protocol, shared contract tests,
                                         transport-specific tests
Step 4: New surfaces-web package       — Preact + Vite SPA, LoginForm, session list/     [vite]
                                         detail, event stream, control bar, status panel
Step 5: Update surfaces-cli            — remote sessions/attach/run commands,            [tsup]
                                         gateway run command, config additions
```

---

## Verification Commands

```bash
# Type check
pnpm -r type-check

# All tests
pnpm -r test

# Observability contract (gate — must pass before anything else)
pnpm --filter observability test -- --grep "contract"

# Gateway auth (API key + session token + WS post-connect)
pnpm --filter gateway test -- --grep "auth"

# Gateway routes (session list/detail/control/goals/status)
pnpm --filter gateway test -- --grep "routes"

# Gateway operator WS event streaming + backfill
pnpm --filter gateway test -- --grep "event-stream"

# Gateway runtime protocol WS
pnpm --filter gateway test -- --grep "runtime-protocol"

# Gateway TLS enforcement + trustProxy
pnpm --filter gateway test -- --grep "tls"

# Gateway profile validation (safe-local rejected, vibe loopback-only, platform requires allowRemote)
pnpm --filter gateway test -- --grep "profile"

# Gateway Origin validation
pnpm --filter gateway test -- --grep "origin"

# Gateway status endpoint redaction
pnpm --filter gateway test -- --grep "status"

# Runtime remote — shared contract suite
pnpm --filter runtime-remote test -- --grep "contract"

# Runtime remote — transport-specific (reconnect, timeout, auth expiry)
pnpm --filter runtime-remote test -- --grep "transport"

# Browser UI components
pnpm --filter surfaces-web test

# CLI remote commands
pnpm --filter surfaces-cli test -- --grep "remote"

# CLI gateway command
pnpm --filter surfaces-cli test -- --grep "gateway"

# Remote approval flow (v4)
pnpm --filter gateway test -- --grep "approval"

# Runtime proxy fencing (v4)
pnpm --filter gateway test -- --grep "runtime-proxy"

# Trusted proxy request-time validation (v4)
pnpm --filter gateway test -- --grep "trusted-proxy"
```

---

## Risk Assessment

| Risk | Mitigation |
| ---- | ---------- |
| Gateway becomes a product-defining layer | Hard rule: local operation never requires gateway. Gateway receives pre-assembled deps, does not own assembly. All P1/P2 tests pass without gateway. |
| Auth bypass via WS | WS uses post-connect auth message (v2). No query-param tokens. Token validated on every message. |
| Token leak in browser | No localStorage, no cookies, no URL params. Memory-only JS variable. LoginForm clears API key after mint. |
| Long-lived WS outlives token | Gateway checks token TTL on each WS message. Expired → close connection (v2). |
| Event stream backpressure | WS has per-client buffer. If client is too slow, server closes connection with backpressure error. Client can reconnect. |
| RemoteRuntime masks server errors | All server errors propagated as typed exceptions with original error message via `runtime.error` response. No silent swallowing. |
| Browser UI XSS from trace data | All content rendered as text nodes, never innerHTML. No user-generated HTML in events. |
| Plaintext bearer tokens over network | TLS required for non-loopback. `trustProxy` for reverse proxy setups. Loopback exempt for local dev only. |
| Stale session tokens | Tokens stored in memory Map with TTL. Server-side sweep timer (30s) closes expired connections. Server restart invalidates all tokens. |
| Ctrl+C accidentally cancels remote session | Ctrl+C = detach only (v2). CLI cancel requires explicit `/cancel` command. Browser cancel requires confirmation dialog. |
| Unauthenticated WS socket accumulation | 5-second auth deadline (v3). Connections that don't authenticate in time are closed. |
| Spoofed proxy headers bypass TLS | `trustProxyCIDRs` requires explicit IP ranges (v3). Source IP validated before accepting non-TLS traffic. |
| runtime-remote split-brain | No split-brain possible — server is authoritative. RemoteRuntime is transparent proxy with no local state (v3). |
| Gateway crash orphans remote clients | WS close event sent to all clients. Clients detect disconnect and can reconnect when gateway restarts. Session state unaffected (persisted in state-store). |
| Runtime protocol request ordering | Each request carries `requestId` (UUID). Server matches responses by ID. Concurrent requests supported. |
| Browser WS cross-origin attack | Origin header validated on WS upgrade (v2). Non-loopback requires matching allowed origins. |

---

## Explicit Exclusions (not in Phase 3)

- No ACP runtime adapter (Phase 4 — spec stability needed)
- No MCP compatibility (Phase 4)
- No multi-user RBAC (Phase 4 — single operator only)
- No JWT tokens (Phase 4 — if multi-node gateway needed)
- No chat surfaces (Phase 4)
- No SSR for browser UI
- No router/state library for browser UI
- No webhook automation source (deferred from v1 — Phase 3.1 or Phase 4)
- No automation daemon mode (deferred from v1 — Phase 3.1 or Phase 4)
- No gateway daemonization (foreground only in Phase 3)

---

## Packages Added in Phase 3

| Package | Role | Build |
|---------|------|-------|
| `gateway` | HTTP/WS server, auth, operator API, runtime protocol, profile enforcement | tsc |
| `runtime-remote` | Client-side AgentRuntime proxy over /ws/runtime | tsc |
| `surfaces-web` | Preact browser UI (session viewer + control) | vite |

## Packages Updated in Phase 3

| Package | Changes |
|---------|---------|
| `observability` | 10 new gateway/remote event types (including approval events) |
| `security` | Gateway profile validation rules (activated `allowRemote`) |
| `surfaces-cli` | Remote commands (`remote sessions/attach/run`), `gateway run`, config additions |

---

## Status

- [x] Key questions answered (4/4 — auth, runtime, browser UI, remote attach)
- [x] Codex co-review on all 4 design decisions
- [x] v1 drafted
- [x] Codex Plan Review Round 1 — 10 findings (3 high, 4 medium-high/medium, 3 low-medium)
- [x] Plan updated to v2 (runtime protocol, WS auth, scope trim, authorization, redaction, detach/cancel)
- [x] Codex Plan Review Round 2 — 7 findings (2 high, 2 medium-high, 2 medium, 1 low-medium). Score: 8/7/7/8 = 7.5
- [x] Plan updated to v3 (browser cancel, runtime-remote role, WS sweep timer, trustProxyCIDRs, auth timeout, goals response)
- [x] Codex Plan Review Round 3 — 4 findings (1 high, 2 medium-high, 1 low). Score: 8.5/8.5/8/8.5 = 8.4
- [x] Plan updated to v4 (remote approval flow, runtime.proxy fencing, request-time proxy validation, terminology cleanup)
- [x] Codex Plan Review Round 4 — Score: 9.1/9.0/9.0/9.2 = 9.1. APPROVED.
- [x] Plan finalized (v4)
