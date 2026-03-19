# Phase 4 Implementation Plan: Ecosystem & Compatibility

Status: v9 — FINAL — Post Codex Round 8 review
Source: `docs/WORK_AGENT_ARCHITECTURE.md` + `.plans/PHASE_PLAN.md`
Scope: Phase 4 — MCP compatibility layer + chat surface
Prerequisite: Phase 3 complete (2026-03-19)

---

## Changelog from v1 (Codex Round 1 Review — scores 7/7/6/7)

| # | Change | Reason |
| - | ------ | ------ |
| 1 | Expanded Step 4.2 to include `runtime-embedded` (response-parser.ts, prompt-builder.ts) and `work-core` (engine.ts category mapping) | v1 only touched work-contracts/exec-substrate/security. Adding mcp-call to ActionType alone won't work — response parser rejects unknown types, prompt doesn't advertise MCP tools, and engine maps unknown types to "read". |
| 2 | Removed `"mcp"` ActionCategory. Each MCP tool maps to existing categories (read/patch/shell/network) via security-classifier. Unclassified = denied. | v1 was contradictory: added "mcp" category AND said tools map to existing categories. Two models. Per-tool classification into existing categories is simpler and consistent. |
| 3 | Tightened substrate extension map from `Map<string, ActionHandler>` to `Map<ActionType, ActionHandler>` with constructor guard rejecting built-in keys | v1 extension map was untyped string — broader than the action system. Guard prevents built-in override. |
| 4 | Changed MCP transport from `stdio + SSE` to `stdio + Streamable HTTP` (SSE as legacy fallback only) | MCP TypeScript SDK docs say Streamable HTTP is recommended for remote; HTTP+SSE is deprecated for backward compat. |
| 5 | Slack slash command handler now acks within 3 seconds, processes goal submission asynchronously. Notification uses `response_url` (not webhookUrl) for per-channel reply. | Slack requires 200 response within 3s. Incoming webhooks can't override destination channel — response_url from slash command is the correct reply mechanism. |
| 6 | Added scoped auth guidance: chat bot uses dedicated API key with reduced `defaultPermissions` (only `goals.submit` + `sessions.read`) | v1 didn't address least-privilege — single API key with full permissions is too broad for a chat integration. |
| 7 | Added pending-notification JSON store with startup reconciliation for notification durability | v1 had no recovery if surfaces-chat restarts before session completion — terminal notification would be lost. |
| 8 | Clarified chat.* event ownership: surfaces-chat writes its own local JSONL trace via local EventBus instance | v1 was silent on where chat events get recorded. surfaces-chat is an external client — events are operational logs, not session traces. |
| 9 | Added MCP tool argument schema validation before execution | Codex flagged: arguments must be validated against discovered MCP tool schema to prevent malformed calls. |

## Changelog from v8 (Codex Round 8 Review — scores 8.9/8.9/8.8/8.7)

| # | Change | Reason |
| - | ------ | ------ |
| 27 | `getAllTools()` and prompt injection only expose Tier-2-allowed tools. Denied tools are filtered out before reaching `WorkEngineOptions.mcpTools` or the model prompt. | v8 didn't specify whether denied tools appear in the prompt. If the model sees denied tools, it can choose them and Tier 2 rejects — wasted turn. Only allowed tools should be advertised. |
| 28 | `securityCategory` in `McpToolPolicy` is now optional metadata (for observability), not behavioral. Default: `"network"`. `defaultToolPolicy: "allow"` uses `securityCategory: "network"` implicitly. | v8 still required securityCategory in McpToolPolicy but Tier 2 only checks `allowed`. Category is metadata for event logging, not for policy evaluation. Made optional with sensible default. |
| 29 | Fixed stale wording: §4.3.5 no longer says "for the security policy to evaluate." §4.5 registration uses `createMcpActionHandler(manager, classifier, eventBus)` (no `policy` param). | Two text inconsistencies from v7→v8 Tier 2 redesign. |

## Changelog from v7 (Codex Round 7 Review — scores 8.9/9.0/8.6/8.9)

| # | Change | Reason |
| - | ------ | ------ |
| 26 | Tier 2 no longer calls `SecurityPolicy.evaluate()`. Tier 2 is config-based allow/deny only via `classifier.classifyTool()`. Removed `SecurityPolicy` param from `createMcpActionHandler`. | v7 passed `mcp-call` action into `policy.evaluate(action, "shell")`, but shell policy reads `action.params.executable` — shape mismatch. Existing policy expects category-specific action params. Fix: don't reuse SecurityPolicy at Tier 2. Tier 1 (Work Core) already handles profile-level policy + requiresConfirmation via "network" gate. Tier 2 is adapter-level config gate only. |

## Changelog from v6 (Codex Round 6 Review — scores 8.8/8.8/8.3/8.6)

| # | Change | Reason |
| - | ------ | ------ |
| 23 | Wired Tier 2 security in substrate handler: handler uses `classifier.classifyTool()` for config-based allow/deny before MCP call. | v6 handler received classifier but never called it. Tier 2 was described but not enforced. (Note: v7 tried reusing SecurityPolicy.evaluate at Tier 2 but v8 reverted this — see changelog 26.) |
| 24 | Added `getToolDefinition(name)` to McpClient API. Handler uses this to look up tool metadata for classification and schema validation. | v6 handler used `client.getTool()` which was not listed in the client API spec. |
| 25 | Fixed three wording inconsistencies: §4.2.4 removed stale ExecuteGoalOptions reference, §4.4.1 updated from "dedicated API key" to "shared API key + scoped token", §4.5 updated factory wiring to reflect WorkEngineOptions path. | Codex flagged editorial drift between early and late sections. |

## Changelog from v5 (Codex Round 5 Review — scores 8.5/8.5/8.0/8.8)

| # | Change | Reason |
| - | ------ | ------ |
| 21 | `POST /auth/token` body parsing is backward-compatible: empty/missing body → mint with full defaultPermissions (existing behavior). Only when body contains `permissions` array does intersection apply. Uses optional body parsing, not required. | v5 didn't specify backward compat. Existing callers send empty body to /auth/token — would regress to 400 if body parser requires JSON. |
| 22 | Restore-time context refresh is now unconditional: always call `loadContext()` after `hydrateSession()`, setting `mcpTools` to current list or `undefined`. Clears stale snapshot-time tools when engine has no MCP. | v5 only refreshed when `this.mcpTools.length > 0`. If snapshot had MCP tools but current engine doesn't, stale tools would persist in context. |

## Changelog from v4 (Codex Round 4 Review — scores 8/8/7/8)

| # | Change | Reason |
| - | ------ | ------ |
| 18 | Moved `mcpTools` from `ExecuteGoalOptions` to `WorkEngineOptions`. WorkEngine stores tool list at construction and includes it in every `loadContext()` call. All goal entry points (CLI, gateway, automation) get MCP tools automatically. | v4 put mcpTools in ExecuteGoalOptions — only works for callers that explicitly pass it. Gateway goals.ts and automation dispatcher.ts don't pass ExecuteGoalOptions.mcpTools. WorkEngineOptions is set once at construction, covers all paths. |
| 19 | Added token refresh strategy to surfaces-chat gateway-client: catch 401 / `auth.expired` → re-authenticate with API key → re-mint scoped token. Standard retry-on-auth-failure pattern. | v4 minted scoped token once at startup. Gateway tokens expire by design (TTL). Long-lived Slack service needs refresh. |
| 20 | Added mcpTools context refresh on session restore: after `hydrateSession()`, Work Core calls `loadContext()` with current mcpTools to replace snapshot-time tool list. | Restored sessions may carry stale mcpTools from snapshot. MCP servers may have changed since snapshot was taken. |

## Changelog from v3 (Codex Round 3 Review — scores 7/8/6/8)

| # | Change | Reason |
| - | ------ | ------ |
| 15 | Added `mcpTools?` to `ExecuteGoalOptions` in work-core. Work Core passes it into `runtime.loadContext()` call at engine.ts:105. This is the concrete injection point. | v3 added mcpTools to ContextPayload but had no producer — Work Core builds context inline and had no way to receive MCP tool descriptions. ExecuteGoalOptions is the existing injection point for per-execution config. |
| 16 | Added scoped token minting to gateway: `POST /auth/token` now accepts optional `permissions` in request body, intersected with operator's existing permissions. ~5 lines added to auth-routes.ts. | v3 claimed existing token minting supported scoped permissions, but `handleMintToken` always uses `config.auth.defaultPermissions`. Small gateway enhancement, useful beyond chat. |
| 17 | Fixed gateway-client.getSession return type to `WorkSession` (not `SessionSummary`). Gateway `GET /api/sessions/:id` already returns full WorkSession via `store.loadSession()`. | v3 typed it as SessionSummary but formatter needs artifacts and duration which only exist on WorkSession. |

## Changelog from v2 (Codex Round 2 Review — scores 7/8/7/8)

| # | Change | Reason |
| - | ------ | ------ |
| 10 | Explicitly documented two-tier MCP authorization model: Work Core global gate (`mcp-call` → `"network"`) + adapter-mcp per-tool fine-grained check. Platform profile requires `allowNetwork: true` for any MCP usage. | v2 was ambiguous — claimed per-tool authorization but Work Core evaluates policy before substrate runs. The coarse gate + fine check is defensible but was not explicitly documented. |
| 11 | Added `mcpTools?` field to `ContextPayload` in agent-runtime/types.ts. This is the injection point — context already flows through EmbeddedRuntime → ModelClient → prompt-builder unchanged. No changes needed to runtime.ts or http-client.ts. | v2 said to update runtime.ts and http-client.ts, but ContextPayload already flows end-to-end. Adding the field to ContextPayload is sufficient — the existing plumbing carries it. |
| 12 | Resolved chat auth: chat bot authenticates with shared API key, then mints a scoped session token via `POST /auth/token` with only `goals.submit` + `sessions.read` permissions. Uses token for all subsequent requests. | v2 assumed dedicated API key, but gateway only supports one key. Existing TokenStore.mintToken already supports per-token permissions — no gateway changes needed. |
| 13 | Added `gateway-client.getSession(sessionId)` to fetch session details (artifacts, duration) before formatting terminal notification. | v2 formatter assumed artifact count and duration were available from terminal events, but `session.completed` only carries `evidence` and `session.failed` only carries `error`. |
| 14 | Added explicit post-ack failure path: on async goal submission failure, POST error to `response_url`, emit `chat.notification.failed`, do not create pending notification. | v2 was silent on what happens if goal submission fails after the Slack 3-second ack has already been returned. |

---

## Phase 4 Theme

> Connect to external tool ecosystems without letting them reshape the core.

Phase 3 proved the core is remotely accessible. Phase 4 extends its reach to external tool ecosystems and chat platforms — as optional edge adapters, never as core semantics.

**Target user**: Power users integrating Octopus with MCP tool servers or team chat workflows.

**Iron rule (inherited)**: Nothing in Phase 4 redefines Phase 1/2/3 semantics. MCP is at the edge. Chat is intake + notification. Core does not think in MCP.

---

## Key Design Decisions

| Question | Decision | Rationale |
| -------- | -------- | --------- |
| MCP injection point | Substrate extension (`mcp-call` ActionType) | Architecture says "optional substrate additions." One execution path. Work Core unchanged. Events emit naturally via substrate eventing. Reviewed with Codex. |
| MCP tool security | Two-tier model: Tier 1 = Work Core maps `mcp-call` → `"network"` (profile-level gate via `SecurityPolicy.evaluate`). Tier 2 = adapter-mcp config-based per-tool allow/deny (does NOT reuse SecurityPolicy — avoids action shape mismatch). Both must pass. | Work Core handles profile + confirmation. Adapter handles config gate. Existing policy expects category-specific action params (e.g. executable for shell) — can't pass mcp-call actions. Codex flagged across v1-v7. |
| MCP scope | Tool capabilities only. MCP resources/prompts excluded from core. | Resources are context-loading (already handled by substrate read). Prompts are prompt-injection surface. Keep MCP narrow. Codex recommended "Option A with curation." |
| MCP transport | stdio (local) + Streamable HTTP (remote). SSE as legacy fallback only. | MCP SDK docs recommend Streamable HTTP for remote servers. SSE deprecated. |
| Chat feedback scope | Goal intake + terminal notification only | Ack on goal submission. Completion/failure summary on session end. No status updates, no approvals, no event streaming in chat. Hard boundary. Reviewed with Codex. |
| Chat never sends | pause / resume / cancel / approve / execution logs | Prevents chat from becoming a full execution surface. Execution semantics live in CLI/web/gateway only. Codex flagged scope-creep risk. |
| Chat reply mechanism | Slack `response_url` from slash command (not webhookUrl) | response_url replies to the correct channel. Incoming webhooks are fixed-channel and can't route dynamically. Codex flagged. |
| Chat auth | Chat bot authenticates with shared API key → mints scoped session token via `POST /auth/token` with `permissions: ["goals.submit", "sessions.read"]` in body. Small gateway enhancement: token route accepts optional permissions, intersected with operator's permissions. | v3 assumed scoped minting existed — it doesn't. Small ~5-line enhancement to auth-routes.ts. Codex flagged. |
| External adapters | Gateway API sufficient for alpha. No adapter packages. | POST /api/goals already exists. Document + example integrations. Promote to package only after 2+ real integrations share mapping code. Reviewed with Codex. |
| Substrate extensibility | `Map<ActionType, ActionHandler>` with constructor guard rejecting built-in keys | Typed extension map. Built-in switch cases take priority. Guard prevents override attempts. Codex flagged v1 loose typing. |
| chat.* event ownership | surfaces-chat writes its own local JSONL trace. Not part of session traces. | surfaces-chat is an external client — operational logs, not work events. Codex flagged. |

---

## Deliverables Overview

| # | Deliverable | Packages Affected | Priority |
| - | ----------- | ----------------- | -------- |
| 4.1 | Observability: MCP + Chat event types | `observability` | P0 — gate |
| 4.2 | Core updates: ActionType + substrate ext + context + gateway + runtime + engine | `work-contracts`, `exec-substrate`, `agent-runtime`, `gateway`, `runtime-embedded`, `work-core` | P0 — foundation |
| 4.3 | MCP Compatibility Layer | `adapter-mcp` (new) | P0 — primary deliverable |
| 4.4 | Chat Surface: Slack Adapter | `surfaces-chat` (new) | P1 — secondary deliverable |
| 4.5 | CLI updates + integration wiring | `surfaces-cli` | P1 — surface |

---

## 4.1 Observability: MCP + Chat Event Types

**Files**: `packages/observability/src/types.ts`, `packages/observability/src/__tests__/contract.test.ts`

Add two new event groups (I and J) following the established pattern from groups A–H.

### Group I: MCP Events

```typescript
export type McpEventType =
  | "mcp.server.connected"     // { serverId: string; transport: "stdio" | "streamable-http" | "sse"; toolCount: number }
  | "mcp.server.disconnected"  // { serverId: string; reason: string }
  | "mcp.tool.called"          // { serverId: string; toolName: string; sessionId: string }
  | "mcp.tool.completed"       // { serverId: string; toolName: string; durationMs: number; success: boolean }
  | "mcp.tool.failed";         // { serverId: string; toolName: string; error: string }
```

### Group J: Chat Events

```typescript
export type ChatEventType =
  | "chat.goal.received"        // { platform: string; channelId: string; userId: string; goalDescription: string }
  | "chat.notification.sent"    // { platform: string; channelId: string; sessionId: string; notificationType: "ack" | "completion" | "failure" }
  | "chat.notification.failed"; // { platform: string; channelId: string; sessionId: string; error: string }
```

### Updates

- Add `"mcp"` and `"chat"` to `SourceLayer`
- Create 8 typed payload interfaces
- Register all in `EventPayloadByType` map
- Extend `WorkEventType` union
- Add contract test assertions for all 8 events

---

## 4.2 Core Updates: ActionType + Substrate Extension + Security + Runtime + Engine

Six coordinated changes across existing packages. This is the critical integration step — without it, mcp-call actions cannot flow end-to-end.

### 4.2.1 work-contracts: Add `mcp-call` ActionType

**File**: `packages/work-contracts/src/types.ts`

```typescript
export type ActionType = "read" | "patch" | "shell" | "search" | "model-call" | "mcp-call";
```

Single line change. No logic. Unlocks the action type for all downstream packages.

### 4.2.2 exec-substrate: Extension Mechanism

**Files**: `packages/exec-substrate/src/types.ts`, `packages/exec-substrate/src/substrate.ts`

Add a typed, guarded extension map to `ExecutionSubstrate`:

```typescript
// types.ts — new export
import type { ActionType } from "@octopus/work-contracts";
export type ActionHandler = (action: Action, context: SubstrateContext) => Promise<ToolResult>;

// substrate.ts — updated constructor + default case
const BUILT_IN_TYPES: ReadonlySet<string> = new Set(["read", "patch", "shell", "search", "model-call"]);

export class ExecutionSubstrate implements ExecutionSubstratePort {
  constructor(private readonly extensions?: Map<ActionType, ActionHandler>) {
    if (extensions) {
      for (const key of extensions.keys()) {
        if (BUILT_IN_TYPES.has(key)) {
          throw new Error(`Cannot override built-in action type: ${key}`);
        }
      }
    }
  }

  async execute(action: Action, context: SubstrateContext): Promise<ActionResult> {
    switch (action.type) {
      case "read": return executeRead(action, context);
      case "patch": return executePatch(action, context);
      case "search": return executeSearch(action, context);
      case "shell": return executeShell(action, context);
      case "model-call":
        throw new Error("model-call is handled by the runtime, not exec-substrate.");
      default: {
        const handler = this.extensions?.get(action.type);
        if (handler) return handler(action, context);
        throw new Error(`Unsupported action type: ${String(action.type)}`);
      }
    }
  }
}
```

**Rules**:
- Extension map is `Map<ActionType, ActionHandler>` — typed, not `Map<string, ...>`
- Constructor guard rejects built-in key registration (throws on "read", "patch", "shell", "search", "model-call")
- Built-in switch cases still take priority as defense-in-depth
- Extension handler receives the same `SubstrateContext` — full observability
- If no extension registered for action type, throw (existing behavior preserved)

### 4.2.3 security: No Changes (Two-Tier Model)

**NO CHANGES to `packages/security/`** — MCP authorization uses a two-tier model that requires no security package modifications:

**Tier 1 — Work Core global gate** (evaluated in engine.ts before substrate execution):
- `mcp-call` → `"network"` category
- This is a coarse enable/disable gate at the profile level

**Tier 2 — adapter-mcp per-tool check** (evaluated in substrate handler before MCP call):
- Each tool classified into `read`/`patch`/`shell`/`network` via security-classifier
- Denied tools rejected even if Tier 1 passed

| Profile | Tier 1 (network gate) | Tier 2 (per-tool) | Net effect |
| ------- | -------------------- | ----------------- | ---------- |
| `safe-local` | **denied** (network blocked) | N/A — never reached | MCP unavailable |
| `vibe` | **allowed** (network allowed) | Per-tool classify + allow/deny | Per-tool control, most tools allowed |
| `platform` | Requires `allowNetwork: true` in policy file | Per-tool classify + allow/deny | Must enable network AND configure per-tool policy |

**Note**: This means `platform` profile operators who want MCP must set `allowNetwork: true`. If a future use case requires MCP without general network access, a dedicated `allowMcp` flag can be added to `PolicyResolution` — deferred unless real demand exists.

### 4.2.4 agent-runtime: Add mcpTools to ContextPayload

**File**: `packages/agent-runtime/src/types.ts`

```typescript
export interface McpToolDescription {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ContextPayload {
  workspaceSummary?: string;
  visibleFiles?: string[];
  plan?: string;
  todo?: string;
  status?: string;
  mcpTools?: McpToolDescription[];    // NEW — MCP tool descriptions for prompt injection
}
```

**Why ContextPayload?** The existing plumbing already flows ContextPayload end-to-end:
1. Work Core calls `runtime.loadContext(sessionId, context)` — stores context (engine.ts:105)
2. `runtime.requestNextAction(sessionId)` passes context to `modelClient.completeTurn()` (runtime.ts:137)
3. `HttpModelClient.completeTurn()` passes context to `buildTurnPrompt()` (http-client.ts:14)
4. `buildTurnPrompt()` reads `context.mcpTools` — **this is the only prompt-level change needed**

No changes required to `runtime.ts`, `http-client.ts`, or `ModelClient.completeTurn` interface. The existing context pipeline carries mcpTools automatically.

**But: Work Core needs a producer.** ContextPayload is built inline at engine.ts:105. The injection point is `WorkEngineOptions` — set once at construction, covers all goal entry paths:

### 4.2.4b work-core: mcpTools in WorkEngineOptions

**File**: `packages/work-core/src/engine.ts`

Add `mcpTools` to `WorkEngineOptions` (not `ExecuteGoalOptions`). This ensures ALL goal entry points — CLI, gateway, automation — get MCP tools automatically without each caller needing to pass them.

```typescript
export interface WorkEngineOptions {
  verificationPlugins?: VerificationPlugin[];
  workspaceLock?: WorkspaceLock;
  mcpTools?: McpToolDescription[];   // NEW — set once at construction, covers all goal paths
}
```

WorkEngine stores it as an instance field:

```typescript
export class WorkEngine {
  private readonly mcpTools: McpToolDescription[];
  // ...
  constructor(runtime, substrate, stateStore, eventBus, policy, options: WorkEngineOptions = {}) {
    // ... existing code ...
    this.mcpTools = options.mcpTools ?? [];
  }
}
```

Update `startSession()` to include mcpTools in context:

```typescript
private async startSession(goal: WorkGoal, workspaceRoot?: string): Promise<WorkSession> {
  // ... existing code ...
  await this.runtime.loadContext(session.id, {
    workspaceSummary: workspaceRoot,
    visibleFiles: workspaceRoot ? await listVisibleFiles(workspaceRoot) : [],
    plan: `Goal: ${goal.description}`,
    todo: "Execute next action",
    status: `Session state: ${session.state}`,
    mcpTools: this.mcpTools.length > 0 ? this.mcpTools : undefined
  });
  // ... rest unchanged ...
}
```

Update `restoreSession()` to unconditionally refresh context after hydration:

```typescript
private async restoreSession(resumeFrom, goal): Promise<WorkSession> {
  // ... existing snapshot hydration ...
  const session = await this.runtime.hydrateSession(snapshot);
  // Always refresh context after restore — clears stale mcpTools if engine has none,
  // updates to current tools if engine has MCP configured
  await this.runtime.loadContext(session.id, {
    ...snapshot.runtimeContext.contextPayload,
    mcpTools: this.mcpTools.length > 0 ? this.mcpTools : undefined
  });
  return session;
}
```

**Why unconditional?** If the snapshot was taken when MCP was configured but the current engine has no MCP tools, stale tool descriptions would persist in context. Always refreshing ensures the prompt matches the current engine configuration.

**Factory wiring**: When MCP is configured:
```typescript
const engine = new WorkEngine(runtime, substrate, stateStore, eventBus, policy, {
  mcpTools: manager.getAllTools()   // set once, covers all callers
});
```

When MCP is not configured, `mcpTools` is undefined → prompt identical to Phase 3. Gateway `handleSubmitGoal`, automation `dispatcher`, and CLI all call `engine.executeGoal()` without needing to know about MCP — the engine already has the tools.

### 4.2.5 gateway: Scoped Token Minting

**File**: `packages/gateway/src/routes/auth-routes.ts`

Small enhancement to `POST /auth/token`: accept optional `permissions` in request body, intersected with operator's permissions.

```typescript
export async function handleMintToken(deps: RouteDeps, operator: OperatorContext, body?: unknown) {
  if (operator.authMethod !== "api-key") {
    throw new HttpError(403, "Token minting requires API key authentication.");
  }

  const basePermissions = deps.config.auth.defaultPermissions;

  // Backward-compatible: empty/missing body → full defaultPermissions (existing behavior)
  // Only when body contains permissions array does intersection apply
  const requestedPermissions = isRecord(body) && isPermissionArray(body.permissions)
    ? body.permissions
    : null;

  const permissions = requestedPermissions
    ? requestedPermissions.filter((p) => basePermissions.includes(p))
    : basePermissions;

  const { token, expiresAt } = deps.tokenStore.mintToken(operator.operatorId, permissions);
  return { token, expiresAt };
}
```

**Backward compatibility**: Empty body or no body → mints with full `defaultPermissions` (identical to current behavior). Only when `{ permissions: [...] }` is present does intersection apply. Existing callers that POST to `/auth/token` with empty body are unaffected.

**Also update**: `server.ts` route handler to use optional body parsing (`readOptionalJsonBody`) and pass result to `handleMintToken`.

### 4.2.6 runtime-embedded: Accept mcp-call + Advertise MCP Tools

**Files**: `packages/runtime-embedded/src/response-parser.ts`, `packages/runtime-embedded/src/prompt-builder.ts`

**response-parser.ts** — Update `ACTION_TYPES` set:

```typescript
const ACTION_TYPES = new Set<ActionType>(["read", "patch", "shell", "search", "model-call", "mcp-call"]);
```

**prompt-builder.ts** — Read `context.mcpTools` (no new parameter — uses existing ContextPayload):

```typescript
export function buildTurnPrompt(input: {
  session: WorkSession;
  context?: ContextPayload;
  results: ActionResult[];
}): string {
  const mcpTools = input.context?.mcpTools;
  const baseTypes = "read|patch|shell|search";
  const actionTypes = mcpTools?.length ? `${baseTypes}|mcp-call` : baseTypes;

  const lines = [
    "You are Octopus, a local-first work agent runtime.",
    "Return ONLY JSON matching this schema:",
    `{"kind":"action","action":{"id":"string","type":"${actionTypes}","params":{},"createdAt":"ISO8601"}}`,
    // ... existing lines unchanged ...
  ];

  // Append MCP tool descriptions if available
  if (mcpTools?.length) {
    lines.push("", "Available MCP tools (use type: \"mcp-call\" with params: {serverId, toolName, arguments}):");
    for (const tool of mcpTools) {
      lines.push(`  - ${tool.serverId}/${tool.name}: ${tool.description ?? "no description"}`);
    }
  }

  return lines.join("\n");
}
```

**Key rule**: When no MCP tools are in context, prompt and parser behave identically to Phase 3. MCP only appears when tools are loaded into ContextPayload. Function signature unchanged — no callers need updating.

### 4.2.7 work-core: Update Category Mapping

**File**: `packages/work-core/src/engine.ts`

Update `mapActionTypeToCategory` to handle `mcp-call`:

```typescript
function mapActionTypeToCategory(type: Action["type"]): ActionCategory {
  switch (type) {
    case "read":
    case "search":
      return "read";
    case "patch":
      return "patch";
    case "shell":
      return "shell";
    case "model-call":
      return "modelApiCall";
    case "mcp-call":
      return "network";   // MCP calls are external service calls — "network" is the correct base category
    default:
      return "read";
  }
}
```

**Why `"network"` for mcp-call?** This is Tier 1 of the two-tier authorization model. MCP calls communicate with external processes/servers — `"network"` is the correct coarse category. This triggers the profile-level gate:
- `safe-local`: network denied → all MCP blocked
- `vibe`: network allowed → MCP passes Tier 1, adapter-mcp Tier 2 applies per-tool checks
- `platform`: requires `allowNetwork: true` → then adapter-mcp Tier 2 per-tool checks

The adapter-mcp substrate handler (4.3.6) performs the fine-grained Tier 2 check after Work Core's Tier 1 passes.

Update return type from `"read" | "patch" | "shell" | "modelApiCall"` to `ActionCategory` to support the full range.

---

## 4.3 MCP Compatibility Layer (`adapter-mcp`)

**New package**: `packages/adapter-mcp`

### Package Structure

```
adapter-mcp/
  package.json
  tsconfig.json
  src/
    types.ts              — McpServerConfig, McpToolDefinition, McpToolPolicy, McpCallParams
    client.ts             — McpClient wraps @modelcontextprotocol/sdk Client
    manager.ts            — McpServerManager: lifecycle for multiple MCP servers
    schema-adapter.ts     — MCP tool schema ↔ Action params bidirectional conversion + validation
    security-classifier.ts — Map each MCP tool to existing ActionCategory based on config
    substrate-handler.ts  — McpActionHandler: execute mcp-call actions via MCP client
    index.ts              — Public API exports
  __tests__/
    client.test.ts
    schema-adapter.test.ts
    security-classifier.test.ts
    substrate-handler.test.ts
```

### Dependencies

```json
{
  "dependencies": {
    "@octopus/work-contracts": "workspace:*",
    "@octopus/observability": "workspace:*",
    "@octopus/exec-substrate": "workspace:*",
    "@octopus/security": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

### 4.3.1 Types (`types.ts`)

```typescript
export type McpTransport = "stdio" | "streamable-http" | "sse";

export interface McpServerConfig {
  id: string;                          // unique server identifier
  transport: McpTransport;
  command?: string;                    // stdio: executable path
  args?: string[];                     // stdio: arguments
  url?: string;                        // streamable-http/sse: server URL
  env?: Record<string, string>;        // environment variables for stdio
  toolPolicy?: Record<string, McpToolPolicy>;  // per-tool overrides
  defaultToolPolicy?: "deny" | "allow";         // default: "deny"
}

export interface McpToolPolicy {
  allowed: boolean;
  securityCategory?: "read" | "patch" | "shell" | "network";  // optional metadata for observability (default: "network")
  riskLevel?: "safe" | "consequential" | "dangerous";
}

export interface McpToolDefinition {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;   // JSON Schema from MCP server
  policy: McpToolPolicy;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

// The typed envelope for mcp-call Action.params
export interface McpCallParams {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}
```

### 4.3.2 Client (`client.ts`)

Wraps `@modelcontextprotocol/sdk` Client:

- `connect(config: McpServerConfig): Promise<void>` — establish connection via stdio or Streamable HTTP transport
- `disconnect(): Promise<void>` — graceful shutdown
- `listTools(): Promise<McpToolDefinition[]>` — discover available tools, apply policy from config
- `getToolDefinition(name: string): McpToolDefinition | undefined` — look up a specific tool's metadata (for classification and schema validation)
- `callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>` — invoke tool, return result
- Emits `mcp.server.connected` on connect (includes toolCount), `mcp.server.disconnected` on disconnect
- All methods are thin wrappers — SDK handles protocol, client handles eventing + policy lookup

### 4.3.3 Manager (`manager.ts`)

Manages multiple MCP server connections:

- `McpServerManager` holds a `Map<string, McpClient>`
- `startAll(configs: McpServerConfig[]): Promise<void>` — connect to all configured servers
- `stopAll(): Promise<void>` — disconnect all
- `getClient(serverId: string): McpClient | undefined`
- `getServerConfig(serverId: string): McpServerConfig` — return the config for a server (used by classifier)
- `getAllTools(): McpToolDefinition[]` — aggregate **only Tier-2-allowed tools** across all servers (dedupe by `serverId:toolName`). Denied tools are filtered out at this level — they never reach the prompt or `WorkEngineOptions.mcpTools`. This prevents the model from choosing tools that Tier 2 will reject.
- Lifecycle: start when MCP is enabled, stop on shutdown

### 4.3.4 Schema Adapter (`schema-adapter.ts`)

Bidirectional conversion between MCP tool schemas and Octopus Action format:

- `mcpToolToActionDescription(tool: McpToolDefinition): { serverId, name, description, inputSchema }` — convert MCP tool to a description for the runtime prompt
- `validateAndExtractMcpParams(params: Record<string, unknown>): McpCallParams` — validate and extract the typed envelope from Action.params. Throws if `serverId`, `toolName`, or `arguments` are missing/malformed.
- `validateArguments(args: Record<string, unknown>, schema: Record<string, unknown>): void` — validate arguments against the MCP tool's JSON Schema before execution. Reject malformed calls early.
- `mcpResultToActionResult(result: McpToolResult): ActionResult` — convert MCP tool result to ActionResult

**Key rules**:
- The `mcp-call` Action.params must contain the typed `McpCallParams` envelope. Opaque blobs rejected at validation.
- Arguments are validated against the discovered tool schema before the MCP call is made.

### 4.3.5 Security Classifier (`security-classifier.ts`)

Classifies each MCP tool as allowed or denied based on operator config:

- `classifyTool(tool: McpToolDefinition, serverConfig: McpServerConfig): McpToolPolicy`
- Resolution order: per-tool policy in `toolPolicy` → server `defaultToolPolicy` → **deny**
- Unclassified tools are **denied** — never fall through to allow
- Returns `{ allowed, securityCategory?, riskLevel? }` — `allowed` drives Tier 2 gate, `securityCategory` is optional metadata for observability (default: `"network"`)
- When `defaultToolPolicy: "allow"`, tools default to `{ allowed: true, securityCategory: "network" }`

### 4.3.6 Substrate Handler (`substrate-handler.ts`)

The action handler registered with `ExecutionSubstrate` extensions:

```typescript
export function createMcpActionHandler(
  manager: McpServerManager,
  classifier: McpSecurityClassifier,
  eventBus: EventBus
): ActionHandler {
  return async (action: Action, context: SubstrateContext): Promise<ActionResult> => {
    const params = validateAndExtractMcpParams(action.params);
    const client = manager.getClient(params.serverId);
    if (!client) throw new Error(`MCP server not connected: ${params.serverId}`);

    const tool = client.getToolDefinition(params.toolName);
    if (!tool) throw new Error(`MCP tool not found: ${params.serverId}/${params.toolName}`);

    // Tier 2: config-based per-tool allow/deny
    const serverConfig = manager.getServerConfig(params.serverId);
    const toolPolicy = classifier.classifyTool(tool, serverConfig);
    if (!toolPolicy.allowed) {
      return { success: false, output: "", error: `MCP tool denied by config: ${params.toolName}` };
    }

    // Validate arguments against tool schema
    validateArguments(params.arguments, tool.inputSchema);

    // Emit mcp.tool.called event
    emitMcpEvent(eventBus, context, "mcp.tool.called", {
      serverId: params.serverId, toolName: params.toolName, sessionId: context.sessionId
    });

    const startedAt = Date.now();
    try {
      const result = await client.callTool(params.toolName, params.arguments);
      emitMcpEvent(eventBus, context, "mcp.tool.completed", {
        serverId: params.serverId, toolName: params.toolName,
        durationMs: Date.now() - startedAt, success: true
      });
      return mcpResultToActionResult(result);
    } catch (error) {
      emitMcpEvent(eventBus, context, "mcp.tool.failed", {
        serverId: params.serverId, toolName: params.toolName,
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, output: "", error: String(error) };
    }
  };
}
```

**Two-tier security model (final)**:
- **Tier 1 (Work Core, engine.ts:188)**: `policy.evaluate(action, "network")` — profile-level gate. Handles `allowed` AND `requiresConfirmation`. If confirmation required, Work Core blocks the session via existing flow. Substrate handler is only reached after Tier 1 approves.
- **Tier 2 (adapter handler)**: `classifier.classifyTool()` → config-based `allowed` check only. Does NOT call `SecurityPolicy.evaluate()`. This avoids the shape mismatch — existing policy implementations expect category-specific action params (e.g., `action.params.executable` for shell), which `mcp-call` actions don't have. Tier 2 is purely config-driven: per-tool `toolPolicy` → server `defaultToolPolicy` → deny.

**Why Tier 2 doesn't need SecurityPolicy**: Work Core already evaluated the profile-level policy at Tier 1 before reaching the substrate. Tier 2 adds the adapter-level config gate (which tools are explicitly allowed/denied by the operator's MCP configuration). These are different concerns: Tier 1 = "is the profile allowed to make external calls?" Tier 2 = "is this specific tool enabled in config?"

**Registration**: At startup, if MCP config exists:
```typescript
const mcpHandler = createMcpActionHandler(manager, classifier, eventBus);
const extensions = new Map<ActionType, ActionHandler>([["mcp-call", mcpHandler]]);
const substrate = new ExecutionSubstrate(extensions);
```

---

## 4.4 Chat Surface: Slack Adapter (`surfaces-chat`)

**New package**: `packages/surfaces-chat`

### Package Structure

```
surfaces-chat/
  package.json
  tsconfig.json
  src/
    types.ts               — ChatConfig, SlackConfig, ChatNotification, PendingNotification
    slack/
      adapter.ts           — SlackAdapter: receive slash commands, post notifications
      formatter.ts         — Format session completion into Slack Block Kit JSON
      signature.ts         — Verify Slack request signatures (HMAC-SHA256)
    gateway-client.ts      — Thin HTTP client for gateway POST /api/goals
    notification-listener.ts — Subscribe to gateway WS, dispatch terminal notifications
    pending-store.ts       — JSON file store for pending notifications (durability)
    server.ts              — HTTP server for receiving Slack webhooks
    index.ts               — Public API exports
  __tests__/
    slack-adapter.test.ts
    formatter.test.ts
    signature.test.ts
    notification-listener.test.ts
    pending-store.test.ts
```

### Dependencies

```json
{
  "dependencies": {
    "@octopus/observability": "workspace:*"
  }
}
```

No dependency on work-core, work-contracts, or security. Chat surface talks to the gateway only — it is a pure external client.

### 4.4.1 Types (`types.ts`)

```typescript
export interface SlackConfig {
  signingSecret: string;           // Slack app signing secret for request verification
  botToken?: string;               // Slack Web API bot token (fallback for expired response_url)
  gatewayUrl: string;              // Octopus gateway base URL
  gatewayApiKey: string;           // Shared gateway API key (scoped token minted at connect time)
  listenPort: number;              // Port for receiving Slack slash commands
  listenHost?: string;             // Default: "0.0.0.0"
  pendingStorePath?: string;       // Path for pending notification JSON store (default: ./pending-notifications.json)
}

export interface ChatConfig {
  platform: "slack";               // Extensible to "teams" etc. later
  slack?: SlackConfig;
}

export type ChatNotificationType = "ack" | "completion" | "failure";

export interface ChatNotification {
  platform: string;
  channelId: string;
  sessionId: string;
  type: ChatNotificationType;
  summary: string;
}

export interface PendingNotification {
  sessionId: string;
  responseUrl: string;            // Slack response_url for per-channel reply
  channelId: string;
  goalDescription: string;
  submittedAt: string;            // ISO 8601
}
```

### 4.4.2 Slack Adapter (`slack/adapter.ts`)

Handles inbound Slack slash commands:

- Receives `POST /slack/commands` with Slack payload
- Verifies request signature using `signature.ts` (HMAC-SHA256 with signing secret)
- **Returns 200 with ack text within 3 seconds** (Slack deadline). Goal submission happens asynchronously after ack.
- Async flow after ack:
  1. Extracts goal description from slash command text (e.g., `/octopus clean up the temp directory`)
  2. Submits goal to gateway via `gateway-client.ts` (`POST /api/goals`)
  3. **On success**: saves `PendingNotification` to pending-store, starts notification-listener, posts follow-up to `response_url`: "Goal submitted. Session: `<sessionId>`"
  4. **On failure**: posts error message to `response_url`: "Goal submission failed: `<error>`". Emits `chat.notification.failed`. Does NOT create pending notification entry.
- Emits `chat.goal.received` event (on receipt, before submission attempt)

### 4.4.3 Formatter (`slack/formatter.ts`)

Formats terminal notifications as Slack Block Kit JSON:

- **Completion**: Session ID, goal description, artifact count, duration, status "completed"
- **Failure**: Session ID, goal description, error message, status "failed"
- **Data source**: Formatter receives session details from `gateway-client.getSession(sessionId)` — this provides artifacts, duration, and goal info beyond what the terminal event payload carries
- Keep it minimal — no custom colors, no excessive blocks
- Returns Slack-compatible JSON payload for POST to `response_url`
- Fallback: if `response_url` has expired (30-minute Slack limit), uses Slack Web API with `botToken` to post to channel

### 4.4.4 Signature Verification (`slack/signature.ts`)

```typescript
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean
```

- Standard Slack signature verification (v0 scheme)
- Reject if timestamp drift > 5 minutes (replay protection)
- Uses `crypto.timingSafeEqual` for constant-time comparison

### 4.4.5 Gateway Client (`gateway-client.ts`)

Thin HTTP client for gateway interaction:

- `connect(apiKey: string): Promise<void>` — authenticate with API key, mint scoped session token via `POST /auth/token` with body `{ permissions: ["goals.submit", "sessions.read"] }`. Store token for subsequent requests.
- `submitGoal(description: string, constraints?: string[]): Promise<{ sessionId: string; goalId: string }>` — `POST /api/goals` using scoped session token
- `getSession(sessionId: string): Promise<WorkSession>` — `GET /api/sessions/:id` to fetch full session details (artifacts, duration, goal) for terminal notification formatting. Gateway already returns full `WorkSession` via `store.loadSession()`.
- **Auth model**: Chat bot authenticates with shared gateway API key, then mints a scoped session token via enhanced `POST /auth/token` (Step 4.2.5). The token has only `goals.submit` + `sessions.read` permissions.
- **Token refresh**: Gateway tokens expire by design (configurable TTL, default 1 hour). On 401 response or WS `auth.expired` message, gateway-client re-authenticates with the API key and re-mints a fresh scoped token. Standard retry-on-auth-failure pattern — no explicit refresh timer needed.
- Injectable fetch for testing

### 4.4.6 Notification Listener (`notification-listener.ts`)

Subscribes to gateway WS events and dispatches terminal notifications:

- Connects to `/ws/sessions/:id/events` after goal submission
- Listens for `session.completed` or `session.failed` events only
- On terminal event:
  1. Fetch session details via `gateway-client.getSession(sessionId)` — provides artifacts, duration, goal info
  2. Format notification via `formatter.ts` with session details
  3. POST to Slack `response_url` (from pending-store)
  4. If response_url expired (HTTP 404/410), fall back to Slack Web API with `botToken`
  5. Remove entry from pending-store
- Emits `chat.notification.sent` or `chat.notification.failed`
- Disconnects WS after terminal notification sent
- **Hard boundary**: never listens for or forwards intermediate events (action.*, workitem.*, etc.)

### 4.4.7 Pending Store (`pending-store.ts`)

JSON file for notification durability:

- `save(pending: PendingNotification): void` — append to store
- `remove(sessionId: string): void` — remove completed entry
- `loadAll(): PendingNotification[]` — load all pending entries
- On startup: reconcile — for each pending entry, check gateway `GET /api/sessions/:id` for current state. If terminal, send notification immediately. If active, re-subscribe to WS.
- Simple JSON array file. No database dependency.

### 4.4.8 Server (`server.ts`)

Minimal HTTP server for Slack webhook receiver:

- `ChatServer` class with `start()` / `stop()` lifecycle
- Single route: `POST /slack/commands`
- Request signature verification before processing
- Returns Slack-compatible 200 response within 3s (ack text)
- Emits `chat.*` events via local EventBus instance → local JSONL trace file
- **Event ownership**: surfaces-chat writes its own operational JSONL trace. These events are not part of Octopus session traces.

---

## 4.5 CLI Updates + Integration Wiring

**Files**: `packages/surfaces-cli/src/cli.ts`, `packages/surfaces-cli/src/factory.ts`

### New CLI Commands

```
octopus mcp list-servers          — Show configured MCP servers and connection status
octopus mcp list-tools            — Show available MCP tools across all connected servers
octopus mcp test <server-id>      — Test connection to a specific MCP server
```

### Factory Updates

- `createApp()` in `factory.ts` accepts optional `McpConfig`
- When MCP config present:
  1. Create `McpServerManager` and connect to all configured servers
  2. Create `mcp-call` handler with `createMcpActionHandler(manager, classifier, eventBus)` and register with substrate via extension map
  3. Pass `mcpTools: manager.getAllTools()` into `WorkEngineOptions` at engine construction — tools automatically included in context for all goal entry points
- When MCP config absent: substrate and engine work exactly as before (no MCP handler, no tools in context)

### Config Schema

MCP configuration lives in the workspace `.octopus/config.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "id": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
        "defaultToolPolicy": "deny",
        "toolPolicy": {
          "write_file": { "allowed": true, "securityCategory": "patch" },
          "read_file": { "allowed": true, "securityCategory": "read" }
        }
      }
    ]
  }
}
```

---

## Build Sequence

| Step | Deliverable | Packages | Depends On | Est. Files |
| ---- | ----------- | -------- | ---------- | ---------- |
| 0 | Observability: 8 new event types | `observability` | — | 2 |
| 1 | Core updates: ActionType + substrate ext + context + gateway + runtime + engine | `work-contracts`, `exec-substrate`, `agent-runtime`, `gateway`, `runtime-embedded`, `work-core` | Step 0 | 10 |
| 2 | adapter-mcp: full package | `adapter-mcp` (new) | Step 1 | 12 |
| 3 | surfaces-chat: Slack adapter | `surfaces-chat` (new) | Step 0 | 16 |
| 4 | CLI + integration wiring | `surfaces-cli` | Step 2 | 4 |

**Parallelism**: Steps 2 and 3 are independent (adapter-mcp and surfaces-chat don't depend on each other). They can be built in parallel after Step 1.

---

## Verification Commands

### Per-Step

```bash
# Step 0: Observability
pnpm run type-check
pnpm --filter @octopus/observability test

# Step 1: Core updates
pnpm run type-check
pnpm --filter @octopus/work-contracts test
pnpm --filter @octopus/exec-substrate test
pnpm --filter @octopus/agent-runtime test
pnpm --filter @octopus/gateway test
pnpm --filter @octopus/runtime-embedded test
pnpm --filter @octopus/work-core test

# Step 2: adapter-mcp
pnpm run type-check
pnpm --filter @octopus/adapter-mcp test

# Step 3: surfaces-chat
pnpm run type-check
pnpm --filter @octopus/surfaces-chat test

# Step 4: CLI + wiring
pnpm run type-check
pnpm --filter @octopus/surfaces-cli test
```

### Full Suite

```bash
pnpm run type-check && pnpm test
```

**Pass criteria**: All existing tests pass + all new tests pass + zero type errors.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| MCP SDK instability | Medium | Medium | Pin SDK version. Wrap SDK calls behind our McpClient interface — swap implementation without changing adapter-mcp public API. |
| MCP tool security bypass | Low | High | Deny-by-default policy. Every tool requires explicit classification into existing categories. Safe-local denies all (via "network" base category). No new "mcp" category escape hatch. Codex flagged v1. |
| MCP tool schema mismatch | Medium | Medium | Validate arguments against discovered MCP tool JSON Schema before execution. Schema adapter round-trip tests. Codex flagged. |
| Chat scope creep (approvals in chat) | Medium | Medium | Hard boundary in plan: chat never sends pause/resume/cancel/approve. No intermediate event forwarding. Enforced by notification-listener filter. |
| Slack 3-second deadline miss | Low | Medium | Handler acks immediately with static text. All async work (goal submission, WS subscription) happens after 200 response. Codex flagged. |
| Slack response_url expiry (30 min) | Medium | Low | Fallback to Slack Web API with botToken for long-running sessions. Codex flagged. |
| Chat bot restart loses notifications | Medium | Medium | Pending-notification JSON store with startup reconciliation. Codex flagged. |
| Substrate extension misuse | Low | Medium | `Map<ActionType, ActionHandler>` (typed). Constructor guard rejects built-in keys. Built-in switch cases take priority. Codex flagged v1 loose typing. |
| Runtime prompt/parser not updated | Low | High | Step 4.2 explicitly includes runtime-embedded and work-core. Without these updates, MCP tools are invisible to the model. Codex flagged v1 gap. |

---

## Scope Exclusions (NOT in Phase 4)

- **MCP resources/prompts**: Only tool capabilities enter the system. MCP resources (context) and prompts (instructions) are excluded.
- **MCP as default**: MCP never loads unless explicitly configured. No default MCP servers.
- **New ActionCategory for MCP**: Each MCP tool maps to existing categories. No "mcp" category.
- **Chat approval flow**: Chat never handles approval prompts. Approvals stay in CLI/web/gateway.
- **Chat event streaming**: No intermediate execution events in chat. Terminal notification only.
- **External adapter packages**: No Jira/Linear/Notion adapter packages. Gateway API is the integration point.
- **Teams/Discord adapters**: Only Slack in Phase 4. Additional platforms on demand.
- **MCP server hosting**: Octopus is an MCP client only. It does not expose itself as an MCP server.
- **ACP runtime adapter**: Deferred — ACP spec still evolving. runtime-remote from Phase 3 is sufficient.
- **Multi-key gateway auth**: Least-privilege achieved via scoped token minting enhancement, not multi-key management.
- **Separate `allowMcp` policy flag**: MCP requires `allowNetwork` for now. Dedicated flag deferred unless real demand.

---

## Package Summary

| Package | Status | Role |
| ------- | ------ | ---- |
| `adapter-mcp` | **New** | Optional MCP compatibility layer — tool discovery, security classification, substrate handler |
| `surfaces-chat` | **New** | Slack chat surface — goal intake + terminal notification |
| `observability` | Updated | +8 event types (Groups I + J) |
| `work-contracts` | Updated | +`mcp-call` ActionType |
| `exec-substrate` | Updated | Extension mechanism for additional action handlers |
| `agent-runtime` | Updated | +`McpToolDescription` type, +`mcpTools` field in ContextPayload |
| `gateway` | Updated | +scoped token minting in `POST /auth/token` (accepts optional permissions in body) |
| `security` | No change | Existing categories handle MCP tools (two-tier model) |
| `runtime-embedded` | Updated | +`mcp-call` in response parser, reads `context.mcpTools` in prompt builder |
| `work-core` | Updated | +`mcpTools` in WorkEngineOptions (all entry points), +context refresh on restore, +`mcp-call` → `"network"` in category mapping |
| `surfaces-cli` | Updated | +`mcp` subcommands, MCP config wiring |
