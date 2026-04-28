# Single-Tenant Bootstrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Docker deployment into a one-step experience where the operator opens the browser, completes a setup wizard, and the system becomes usable — no manual `.env` editing for secrets, user hashes, or gateway keys.

**Architecture:** Extend the existing gateway with setup endpoints and persistent system config. Add a frontend setup wizard that gates the login screen. Keep the CLI as the config assembler; the gateway writes persistent config only during setup. Preserve backward compatibility with legacy env-driven deployments.

**Tech Stack:** TypeScript 5, Node.js 20.19+, pnpm 10, Vitest 3, Preact 10, Vite 7, existing `@octopus/*` workspace packages, `node:crypto` for scrypt and key generation.

**Precondition:** Execute this plan from a dedicated git worktree. All 4 release gates must pass before starting (`pnpm test`, `pnpm run type-check`, `pnpm lint`, `pnpm build`).

---

## Release Gates

Before any task can be called done, these commands must pass:

```bash
pnpm test
pnpm run type-check
pnpm lint
pnpm build
```

## Task 1: Add Persistent System Config Layer

**Files:**
- Modify: `packages/gateway/src/types.ts`
- Create: `packages/gateway/src/system-config.ts`
- Create: `packages/gateway/src/__tests__/system-config.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `readSystemConfig(configDir)` returns `null` when the directory does not exist
- `readSystemConfig(configDir)` returns a valid `SystemConfig` when `meta.json`, `runtime.json`, and `auth.json` all exist
- `writeSystemConfig(configDir, config)` creates the directory and all three files atomically
- `isInitialized(configDir)` returns `false` when `meta.json` is missing
- `isInitialized(configDir)` returns `true` when `meta.json` exists with `initialized: true`
- round-trip: write then read produces equivalent config
- old snapshots without `meta.json` are treated as uninitialized

**Step 2: Run focused tests**

```bash
pnpm --filter @octopus/gateway test
```

Expected: fail.

**Step 3: Implement**

Add types to `types.ts`:

```ts
export interface SystemConfig {
  runtime: SystemRuntimeConfig;
  auth: SystemAuthConfig;
  meta: SystemMeta;
}

export interface SystemRuntimeConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface SystemAuthConfig {
  gatewayApiKey: string;
  users: GatewayUserAccount[];
}

export interface SystemMeta {
  initialized: boolean;
  initializedAt: string;
  initializedBy: string;
  schemaVersion: number;
}
```

Implement `system-config.ts`:

- `readSystemConfig(configDir: string): Promise<SystemConfig | null>` — reads and validates all three JSON files
- `writeSystemConfig(configDir: string, config: SystemConfig): Promise<void>` — writes all three files with `mkdir -p`
- `isInitialized(configDir: string): Promise<boolean>` — checks `meta.json` existence and `initialized` flag
- `isWorkspaceWritable(workspaceRoot: string): Promise<boolean>` — attempts a temp file write/delete

All reads must handle missing files gracefully. All writes must use the current `session-serde.ts` pattern of conditional field inclusion.

**Step 4: Re-run tests**

Expected: pass.

**Step 5: Commit**

```bash
git add packages/gateway/src/types.ts packages/gateway/src/system-config.ts packages/gateway/src/__tests__/system-config.test.ts
git commit -m "feat: add persistent system config layer"
```

## Task 2: Add Setup Route Group

**Files:**
- Create: `packages/gateway/src/routes/setup.ts`
- Modify: `packages/gateway/src/server.ts`
- Modify: `packages/gateway/src/types.ts`
- Modify: `packages/gateway/package.json`
- Create: `packages/gateway/src/__tests__/setup.test.ts`
- Modify: `packages/gateway/src/__tests__/server.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `GET /api/setup/status` returns `{ initialized: false, workspaceWritable: true }` on fresh system
- `GET /api/setup/status` returns `{ initialized: true }` after initialization (this endpoint is always available, never 410)
- `GET /api/setup/status` requires no auth
- `POST /api/setup/validate-token` accepts correct token, rejects wrong token
- `POST /api/setup/validate-token` returns `410 Gone` after initialization
- `POST /api/setup/validate-runtime` returns `410 Gone` after initialization
- `POST /api/setup/initialize` creates persistent config and transitions to `ready`
- `POST /api/setup/initialize` returns `409 Conflict` on concurrent attempt
- `POST /api/setup/initialize` returns `410 Gone` on already-initialized system
- `POST /api/setup/initialize` clears `OCTOPUS_SETUP_TOKEN` from `process.env` (best-effort, not a security contract)
- `POST /api/setup/initialize` rejects when workspace is not writable
- `POST /api/setup/initialize` generates gateway API key automatically
- `POST /api/setup/initialize` hashes passwords server-side with scrypt

**Step 2: Run focused tests**

```bash
pnpm --filter @octopus/gateway test
```

Expected: fail.

**Step 3: Implement setup routes**

Add `GatewayConfig` extension:

```ts
// Add to GatewayConfig
systemConfigDir?: string;
setupToken?: string;
```

Implement `setup.ts`:

```ts
export async function handleSetupStatus(deps: RouteDeps): Promise<SetupStatusResponse>
export async function handleValidateToken(deps: RouteDeps, body: unknown): Promise<{ valid: boolean }>
export async function handleValidateRuntime(deps: RouteDeps, body: unknown): Promise<ValidateRuntimeResponse>
export async function handleInitialize(deps: RouteDeps, body: unknown): Promise<{ initialized: true }>
```

Dependency change:

- Add `"@octopus/runtime-embedded": "workspace:*"` to `packages/gateway/package.json` dependencies — required for `HttpModelClient` in `validate-runtime`

Key behaviors:

- `GET /api/setup/status` is always available (even after init) — it returns `{ initialized, workspaceWritable }`; the three mutation endpoints check `isInitialized()` and return `410 Gone` if already initialized
- `validate-token` and `validate-runtime` and `initialize` require `X-Setup-Token` header matching `config.setupToken`
- `validate-runtime` creates a temporary `HttpModelClient`, sends a minimal completion, returns `{ valid, error?, latencyMs? }` with 15-second timeout
- `initialize` acquires an in-memory lock (simple boolean flag), writes system config, clears `process.env.OCTOPUS_SETUP_TOKEN` (best-effort memory hygiene), releases lock
- `initialize` payload shape:

```ts
interface InitializePayload {
  runtime: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  };
  admin: {
    username: string;
    password: string;
  };
  additionalUsers?: Array<{
    username: string;
    password: string;
    role: "operator" | "viewer";
  }>;
}
```

Wire setup routes in `server.ts` — they must bypass normal auth middleware since the system has no users yet.

**Step 4: Re-run tests**

Expected: pass.

**Step 5: Commit**

```bash
git add packages/gateway/src/routes/setup.ts packages/gateway/src/server.ts packages/gateway/src/types.ts packages/gateway/package.json packages/gateway/src/__tests__/setup.test.ts packages/gateway/src/__tests__/server.test.ts
git commit -m "feat: add setup route group for browser-first bootstrap"
```

## Task 3: Add Gateway Config Loading From Persistent System Config

**Files:**
- Modify: `packages/surfaces-cli/src/cli.ts`
- Modify: `packages/surfaces-cli/src/factory.ts`
- Modify: `packages/surfaces-cli/src/__tests__/cli.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `gateway run` with persistent system config uses runtime and auth from disk, not env
- `gateway run` with legacy env (both `OCTOPUS_USERS_JSON` and `OCTOPUS_API_KEY` + `OCTOPUS_MODEL`) operates in legacy mode
- `gateway run` with partial legacy env (only auth or only runtime) enters setup mode, not legacy mode
- `gateway run` with neither persistent config nor legacy env enters setup mode (starts server with `setupToken` set, no users)
- `gateway run` in setup mode still starts the gateway and accepts requests to `/api/setup/status`
- `gateway run` in setup mode does NOT require `gateway.apiKey` from env — generates a temporary internal key
- `createDefaultConfig` merges persistent system config fields correctly
- in setup mode, normal task/session routes return `503 Service Unavailable`

**Step 2: Run focused tests**

```bash
pnpm --filter @octopus/surfaces-cli test
```

Expected: fail.

**Step 3: Implement**

Modify `createDefaultConfig()` in `cli.ts` to add a persistent config loading step:

1. Determine `systemConfigDir` = `${workspaceRoot}/.octopus/system`
2. Call `readSystemConfig(systemConfigDir)`
3. If system config exists: override `runtime.*` and `gateway.users` and `gateway.apiKey` from persistent config
4. If system config missing but a complete legacy env set is present (both auth vars AND runtime vars): legacy mode, log deprecation warning
5. If neither: enter **setup mode**:
   - generate a temporary `gateway.apiKey` via `crypto.randomUUID()` so `assertGatewayConfig()` passes
   - set `gateway.setupToken` from `process.env.OCTOPUS_SETUP_TOKEN`
   - leave `gateway.users` empty
   - set a `setupMode: true` flag on `LocalAppConfig`
   - construct a placeholder `ModelClient` that rejects all calls with `"System not initialized"`

Modify `assertGatewayConfig()` — the assertion already passes because we generate a temp key; no change needed to the assertion itself.

Modify `createGatewayApp()` in `factory.ts`:

- Forward `systemConfigDir`, `setupToken`, and `setupMode` into `GatewayConfig`
- When `setupMode` is true, the gateway server must reject normal task/session routes with `503`

Pass `systemConfigDir` through to `GatewayConfig` so the setup routes know where to write.

**Step 4: Re-run tests**

Expected: pass.

**Step 5: Commit**

```bash
git add packages/surfaces-cli/src/cli.ts packages/surfaces-cli/src/factory.ts packages/surfaces-cli/src/__tests__/cli.test.ts
git commit -m "feat: load gateway config from persistent system config"
```

## Task 4: Add Full Runtime Hot-Swap After Setup

**Files:**
- Modify: `packages/gateway/src/server.ts`
- Modify: `packages/gateway/src/routes/setup.ts`
- Modify: `packages/surfaces-cli/src/factory.ts`
- Modify: `packages/gateway/src/__tests__/setup.test.ts`

**Step 1: Write failing tests**

Add tests for:

- after `POST /api/setup/initialize`, the gateway immediately accepts `/auth/login` with the newly created admin credentials
- after initialization, `GET /api/setup/status` returns `{ initialized: true }`
- after initialization, `GET /api/status` returns `browserLoginConfigured: true`
- after initialization, `POST /api/goals` creates a real session (i.e., the runtime/engine are live, not the placeholder)
- after initialization, normal task/session routes no longer return `503`

**Step 2: Implement runtime hot-swap**

The critical insight: after the setup wizard writes runtime config, the gateway must rebuild the entire execution stack — not just auth. The `GatewayServer` constructor takes `private` (mutable) fields for `engine`, `runtime`, `policy`, etc. The hot-swap reassigns these.

Add a factory function to `factory.ts`:

```ts
export async function rebuildRuntimeStack(
  systemConfig: SystemConfig,
  workspaceRoot: string,
  dataDir: string,
  existingStore: StateStore,
  existingEventBus: EventBus,
  profileName: SecurityProfileName
): Promise<{
  engine: WorkEngine;
  runtime: EmbeddedRuntime;
  policy: SecurityPolicy;
  policyResolution: PolicyResolution;
}>
```

This constructs a new `ModelClient` from `systemConfig.runtime`, a new `EmbeddedRuntime`, a new `ExecutionSubstrate`, and a new `WorkEngine` — reusing the existing `StateStore` and `EventBus` so session history and event subscribers are preserved.

Add a method to `GatewayServer`:

```ts
async applySystemConfig(
  systemConfig: SystemConfig,
  newStack: { engine: WorkEngine; runtime: AgentRuntime; policy: SecurityPolicy; policyResolution: PolicyResolution }
): Promise<void>
```

This method:

1. Replaces `this.engine`, `this.runtime`, `this.policy`, `this.policyResolution`
2. Updates `this.config.auth` with new apiKey, users, permissions
3. Clears all tokens from the token store
4. Flips internal `setupMode` flag to `false`
5. Emits a `gateway.initialized` event

After this method returns, the gateway is fully operational — login, task submission, and monitoring all work without restart.

Wire `handleInitialize` to call `rebuildRuntimeStack` then `applySystemConfig`.

**Step 3: Re-run tests**

Expected: pass.

**Step 4: Commit**

```bash
git add packages/gateway/src/server.ts packages/gateway/src/routes/setup.ts packages/surfaces-cli/src/factory.ts packages/gateway/src/__tests__/setup.test.ts
git commit -m "feat: full runtime hot-swap after setup initialization"
```

## Task 5: Build Frontend Setup Wizard

**Files:**
- Create: `packages/surfaces-web/src/components/SetupWizard.tsx`
- Create: `packages/surfaces-web/src/__tests__/setup-wizard.test.tsx`
- Modify: `packages/surfaces-web/src/App.tsx`
- Modify: `packages/surfaces-web/src/api/client.ts`
- Modify: `packages/surfaces-web/src/i18n/messages.ts`
- Modify: `packages/surfaces-web/src/__tests__/app.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/fixtures.ts`
- Modify: `packages/surfaces-web/src/styles/index.css`

**Step 1: Write failing tests**

Add tests for:

- App renders SetupWizard when `GET /api/setup/status` returns `initialized: false`
- App renders LoginForm when `GET /api/setup/status` returns `initialized: true`
- SetupWizard step 1: enter setup token, validate, proceed
- SetupWizard step 2: enter runtime config, test connection, proceed
- SetupWizard step 3: enter admin username/password with confirmation
- SetupWizard step 4: optional additional users
- SetupWizard step 5: review and initialize
- SetupWizard step 6: success redirect to login
- SetupWizard shows error when workspace not writable
- SetupWizard shows error on invalid setup token
- SetupWizard shows connection test failure message

**Step 2: Run web tests**

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: fail.

**Step 3: Implement**

Add client methods:

```ts
async getSetupStatus(): Promise<{ initialized: boolean; workspaceWritable: boolean }>
async validateSetupToken(token: string): Promise<{ valid: boolean }>
async validateRuntime(token: string, config: RuntimeConfig): Promise<{ valid: boolean; error?: string; latencyMs?: number }>
async initialize(token: string, payload: InitializePayload): Promise<{ initialized: true }>
```

These methods do NOT require auth (no `Authorization` header). They use `X-Setup-Token` header instead.

Implement `SetupWizard.tsx`:

- 6-step wizard with state machine: `token → runtime → admin → users → review → success`
- Each step validates before allowing `Next`
- Step 2 has a "Test Connection" button that calls `validateRuntime`
- Step 3 requires password match confirmation
- Step 5 shows a summary (never echoing API key or passwords in plaintext)
- Step 6 auto-redirects to login after 3 seconds

Modify `App.tsx` boot:

```ts
// Before auth check, call setup status
const [setupStatus, setSetupStatus] = useState<{ initialized: boolean; error?: string } | null>(null);

useEffect(() => {
  client.getSetupStatus()
    .then(setSetupStatus)
    .catch((error) => setSetupStatus({ initialized: false, error: error instanceof Error ? error.message : "Unable to reach the server." }));
}, []);

// Render decision:
if (setupStatus === null) return <LoadingSpinner />;
if (setupStatus.error) return <ErrorPanel message={setupStatus.error} onRetry={() => { setSetupStatus(null); /* re-trigger useEffect */ }} />;
if (!setupStatus.initialized) return <SetupWizard client={client} onComplete={() => setSetupStatus({ initialized: true })} />;
if (!authenticated) return <LoginForm ... />;
return <Dashboard ... />;
```

When `getSetupStatus()` fails, the frontend must NOT silently fall through to the login screen. It must show an explicit error state explaining that the server is unreachable or misconfigured, with a retry button. This is critical: a first-time operator seeing a broken login page instead of a clear "cannot connect" message defeats the product goal.

Add all wizard strings to both `zh-CN` and `en-US` in `messages.ts`.

**Step 4: Re-run tests**

Expected: pass.

**Step 5: Commit**

```bash
git add packages/surfaces-web/src/components/SetupWizard.tsx packages/surfaces-web/src/__tests__/setup-wizard.test.tsx packages/surfaces-web/src/App.tsx packages/surfaces-web/src/api/client.ts packages/surfaces-web/src/i18n/messages.ts packages/surfaces-web/src/__tests__/app.test.tsx packages/surfaces-web/src/__tests__/fixtures.ts packages/surfaces-web/src/styles/index.css
git commit -m "feat: add browser-first setup wizard"
```

## Task 6: Update Docker Packaging For Setup-First Flow

**Files:**
- Modify: `docker-compose.release.yml`
- Modify: `.env.example`
- Modify: `docs/runbooks/single-tenant-release.md`
- Modify: `README.md`

**Step 1: Update compose to use named volume**

Change `docker-compose.release.yml`:

```yaml
services:
  gateway:
    volumes:
      - octopus-data:/workspace
    environment:
      OCTOPUS_SETUP_TOKEN: ${OCTOPUS_SETUP_TOKEN}
      OCTOPUS_GATEWAY_HOST: 0.0.0.0
      OCTOPUS_GATEWAY_PORT: 4321

volumes:
  octopus-data:
```

Remove `OCTOPUS_WORKSPACE` bind mount. Keep it documented as an advanced override only.

**Step 2: Simplify `.env.example`**

Reduce to:

```bash
# Required: one-time setup token for browser-first initialization
OCTOPUS_SETUP_TOKEN=replace-with-a-random-secret

# Optional: web port (default 8080)
OCTOPUS_WEB_PORT=8080

# Optional: gateway bind address
OCTOPUS_GATEWAY_HOST=0.0.0.0
OCTOPUS_GATEWAY_PORT=4321

# Advanced: bind mount instead of named volume (uncomment to use)
# OCTOPUS_WORKSPACE=./workspace
```

Remove `OCTOPUS_API_KEY`, `OCTOPUS_MODEL`, `OCTOPUS_BASE_URL`, `OCTOPUS_GATEWAY_API_KEY`, `OCTOPUS_USERS_JSON` from the standard section. Add a clearly labeled "Legacy env-driven bootstrap (deprecated)" section at the bottom for backward compatibility.

**Step 3: Update runbook**

Rewrite the "Getting Started" section:

1. `cp .env.example .env`
2. Set `OCTOPUS_SETUP_TOKEN` to a random secret
3. `docker compose -f docker-compose.release.yml up -d`
4. Open `http://localhost:8080`
5. Complete the setup wizard
6. Log in and start using Octopus

Add a "Legacy deployment" section for operators using env-driven config.

**Step 4: Verify packaging**

```bash
pnpm build
docker compose -f docker-compose.release.yml config
```

**Step 5: Commit**

```bash
git add docker-compose.release.yml .env.example docs/runbooks/single-tenant-release.md README.md
git commit -m "chore: update Docker packaging for setup-first flow"
```

## Task 7: Add CLI Hash-Password Utility

**Files:**
- Modify: `packages/surfaces-cli/src/cli.ts`
- Modify: `packages/surfaces-cli/src/__tests__/cli.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `octopus release hash-password` outputs a valid scrypt hash
- the output hash can be verified by `verifyPasswordHash`

**Step 2: Implement**

Add a `release` command group with `hash-password`:

```ts
releaseCommand
  .command("hash-password")
  .argument("<password>")
  .description("Generate a scrypt password hash for manual auth.json editing")
  .action(async (password: string) => {
    const hash = await createPasswordHash(password);
    process.stdout.write(`${hash}\n`);
  });
```

Import `createPasswordHash` from `@octopus/gateway`.

**Step 3: Re-run tests**

Expected: pass.

**Step 4: Commit**

```bash
git add packages/surfaces-cli/src/cli.ts packages/surfaces-cli/src/__tests__/cli.test.ts
git commit -m "feat: add release hash-password CLI utility"
```

## Task 8: Run Final Verification

**Step 1: Run all quality gates**

```bash
pnpm test
pnpm run type-check
pnpm lint
pnpm build
```

**Step 2: Run packaging verification**

```bash
docker compose -f docker-compose.release.yml config
```

**Step 3: Manual smoke test**

If Docker is available:

1. `docker compose -f docker-compose.release.yml up -d`
2. Open `http://localhost:8080`
3. Verify setup wizard appears (not login)
4. Complete setup with test credentials
5. Verify redirect to login
6. Log in with created admin account
7. Verify task composer is available

**Step 4: Commit any final fixes**

## Priority Mapping

### P0: Must finish for bootstrap to work

- Task 1: Persistent System Config Layer
- Task 2: Setup Route Group
- Task 3: Gateway Config Loading
- Task 4: Gateway Hot-Reload
- Task 5: Frontend Setup Wizard
- Task 6: Docker Packaging Update

### P1: Strongly recommended

- Task 7: CLI Hash-Password Utility
- Task 8: Final Verification

### P2: Defer

- `octopus release init --non-interactive` (automation bootstrap)
- `octopus release add-user` (post-init user management)
- `octopus release migrate` (legacy env to persistent config)
- browser-based admin settings page

## Dependency And Parallelization Notes

- Task 1 is the hard prerequisite for Tasks 2-4 (they all depend on the system config types and I/O)
- Task 2 depends on Task 1 (setup routes write system config)
- Task 3 depends on Task 1 (CLI reads system config)
- Task 4 depends on Tasks 2 and 3 (hot-reload wires setup routes to live config)
- Tasks 2 and 3 can run in parallel after Task 1
- Task 5 depends on Task 2 (frontend calls setup endpoints)
- Task 6 depends on Task 5 (packaging wraps the complete flow)
- Task 7 is independent of Tasks 2-6 (only depends on gateway's `createPasswordHash` export)

```
Task 1 ──→ Task 2 ──┐
     └──→ Task 3 ──┤──→ Task 4 ──→ Task 5 ──→ Task 6 ──→ Task 8
                    │
Task 7 (independent) ──────────────────────────────────────→ Task 8
```

## Final Verification Commands

Before claiming the bootstrap feature is complete, run:

```bash
pnpm test
pnpm run type-check
pnpm lint
pnpm build
docker compose -f docker-compose.release.yml config
```

Then complete a manual smoke test of the setup wizard flow if Docker is available.
