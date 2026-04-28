# Octopus Single-Tenant Bootstrap And First-Run Design

Date: 2026-04-03
Status: Approved design
Scope: `packages/gateway`, `packages/state-store`, `packages/surfaces-web`, `packages/surfaces-cli`, Docker/compose release infra, operator docs

## Why This Exists

The current single-tenant release baseline proves that Octopus can run as a Dockerized control console with a browser frontend. It does not yet deliver the right first-run experience for internal operators because the deployment still depends on manual environment editing for:

1. runtime credentials
2. browser user password hashes
3. internal gateway bootstrap credentials
4. workspace persistence choices

That is the wrong contract for the intended product experience.

The desired operator journey is:

> deploy with Docker, perform one explicit initialization flow, then use the frontend for task submission and task monitoring.

The goal of this design is to turn first-run setup into a productized bootstrap experience instead of a manual `.env` editing exercise.

## Problem Statement

The current release path asks the deployer to prepare runtime secrets and user hashes before the stack is usable:

- `OCTOPUS_API_KEY`
- `OCTOPUS_GATEWAY_API_KEY`
- `OCTOPUS_USERS_JSON`
- `OCTOPUS_WORKSPACE`

This has three practical problems:

1. it mixes infrastructure boot concerns with product configuration
2. it exposes implementation-shaped configuration to operators who only want the system to become usable
3. it weakens the product promise that the browser is the primary control surface

The single-tenant control console should not require source-level editing to become operational.

## Delivery Approaches Considered

### Approach A: Keep env-first provisioning and improve docs only

Continue using `.env` as the primary bootstrap surface. Improve the runbook and provide better examples for password hashing and workspace setup.

Pros:

- minimal code change
- compatible with current release packaging

Cons:

- still asks operators to manage implementation details manually
- keeps first-run success dependent on env editing accuracy
- does not make the frontend the real primary surface

### Approach B: Browser-first setup wizard after Docker deployment

Deploy the containers with only minimal bootstrap env. On first visit, the frontend detects that Octopus is uninitialized and shows a setup wizard instead of the normal login flow.

The setup wizard collects runtime settings and the first admin account, then the backend:

- hashes passwords
- generates the internal gateway bootstrap secret
- persists system configuration inside the mounted data volume
- marks the system initialized

Pros:

- best match for the intended product experience
- removes manual password-hash handling from normal setup
- makes Docker deployment and frontend usability part of one coherent flow

Cons:

- requires a new initialization state machine and setup endpoints
- requires a persisted system-config layer beyond env parsing

### Approach C: CLI-first bootstrap before Docker start

Provide a host-side command such as `octopus release init` that writes a ready-to-run `.env` or persistent config bundle before `docker compose up`.

Pros:

- automation-friendly
- works well for headless operations

Cons:

- still makes bootstrap feel developer-oriented
- weaker fit for the desired "deploy then use frontend" workflow

## Recommendation

Use **Approach B** as the default product path and keep **Approach C** as a secondary automation fallback.

That means:

- the normal deployment story is `docker compose up -d`, then open the frontend
- if Octopus is not initialized, the frontend shows a setup wizard, not a login screen
- the setup wizard writes the minimum required persistent system configuration
- a future CLI `release init --non-interactive` path is allowed for automation, but it is not the primary operator journey

## Target Operator Experience

The first-run experience should be:

1. operator starts the Docker stack
2. operator opens the frontend URL
3. frontend shows `Setup Wizard` because the system is uninitialized
4. operator enters a bootstrap/setup token
5. operator configures runtime access and the first admin account
6. system validates connectivity and persistence
7. system completes initialization
8. frontend redirects to normal login
9. internal users log in and use the frontend to submit and monitor tasks

The ongoing day-two experience should be:

1. login
2. create task
3. monitor task state and artifacts
4. intervene when blocked
5. inspect checkpoints and roll back if needed

No day-to-day operator should need to edit `.env` or generate password hashes manually.

## Product Contract

### What Docker deployment should do

Docker deployment should only make the application reachable and durable.

It should not require the deployer to precompute browser password hashes or handcraft internal service secrets.

### What initialization should do

Initialization should make the deployed system usable.

It should:

- create the first valid runtime configuration
- create the first valid admin login
- prepare any generated internal secrets
- verify the data volume is writable
- transition the product from `uninitialized` to `ready`

### What the frontend should do after initialization

The frontend remains the primary daily-use surface for:

- task publish
- task monitoring
- blocked-session intervention
- artifact viewing
- checkpoint inspection and rollback
- system health visibility

## Environment Strategy

### What should remain in env

For the bundled single-tenant compose release, env should be reduced to infrastructure bootstrap values only:

- `OCTOPUS_WEB_PORT`
- `OCTOPUS_GATEWAY_HOST`
- `OCTOPUS_GATEWAY_PORT`
- `OCTOPUS_SETUP_TOKEN`
- optional reverse proxy / trusted proxy settings

`OCTOPUS_WORKSPACE` should not be a normal first-run concern in the default path.

### What should move out of env

The following should no longer be required as manual bootstrap inputs for the standard product path:

- `OCTOPUS_API_KEY`
- `OCTOPUS_MODEL`
- `OCTOPUS_BASE_URL`
- `OCTOPUS_GATEWAY_API_KEY`
- `OCTOPUS_USERS_JSON`

These become initialization data written into persistent system config.

### Workspace recommendation

The default compose release should use a Docker named volume for `/workspace`.

Why:

- better default persistence
- fewer host-path errors
- no need to ask ordinary operators to pick a filesystem path

Bind mounts should remain available only as an advanced override for operators who explicitly need host-visible storage.

## Initialization State Model

Octopus should have an explicit bootstrap state:

- `uninitialized`
- `ready`

`initializing` is a transient in-memory flag held only during the `POST /api/setup/initialize` request. It is not persisted. If the gateway crashes mid-initialization before `meta.json` is written, the system remains `uninitialized` on restart and setup can be retried safely.

`setup-failed` is represented as an HTTP error response from the initialize endpoint, not as a long-lived product mode. The system stays `uninitialized` until initialization succeeds.

The gateway must expose a lightweight status check so the frontend can decide whether to render:

- setup wizard
- login screen
- authenticated app shell

If persistent system configuration does not exist, the product is `uninitialized` regardless of whether the containers are healthy.

## Persisted System Configuration

Initialization data should be stored inside the workspace volume, not in source-controlled files.

Recommended persistent location:

- `/workspace/.octopus/system/`

Recommended records:

- `runtime.json`
  - provider
  - model
  - baseUrl
  - apiKey
  - maxTokens
  - temperature
- `auth.json`
  - generated internal gateway bootstrap key
  - static user records with hashed passwords and roles
- `meta.json`
  - initializedAt
  - initializedBy
  - schemaVersion
  - bootstrapMode

This keeps runtime settings, auth data, and lifecycle metadata separated without introducing database complexity.

## Frontend Design

### Setup gate

The frontend should not immediately render the login screen on first run.

Instead:

- app boot calls setup status endpoint
- if status is `uninitialized`, route into setup wizard
- if status is `ready`, route into normal login/dashboard

### Setup wizard steps

The wizard should be concise and operator-oriented.

#### Step 1: Bootstrap access

- enter setup token
- validate that setup is still allowed

#### Step 2: Runtime connection

- provider
- model
- API key
- optional base URL
- optional runtime tuning
- test connection button

#### Step 3: First admin account

- username
- password
- password confirmation

#### Step 4: Optional team accounts

- zero or more operator accounts
- zero or more viewer accounts

V1 can keep this lightweight and optional. Only the first admin is mandatory.

#### Step 5: Review and initialize

- summarize final config without echoing secrets back in plaintext after save
- verify workspace write access
- initialize system

#### Step 6: Success

- show completion message
- redirect to login

### Post-init behavior

After initialization:

- `/setup` should redirect away from the wizard
- login page becomes the entry point
- frontend uses the normal role-aware app shell

## Gateway Design

### Setup endpoints

The gateway should add a setup route group separate from normal auth routes.

Suggested endpoints:

- `GET /api/setup/status` — no auth required, returns `{ initialized: boolean, workspaceWritable: boolean }`
- `POST /api/setup/validate-token` — requires `X-Setup-Token` header, returns `{ valid: boolean }`
- `POST /api/setup/validate-runtime` — requires `X-Setup-Token`, accepts `{ provider, model, apiKey, baseUrl? }`, sends a minimal model completion request (e.g. "respond with OK") with a 15-second timeout, returns `{ valid: boolean, error?: string, latencyMs?: number }`
- `POST /api/setup/initialize` — requires `X-Setup-Token`, accepts full setup payload, writes persistent config, returns `{ initialized: true }`

`GET /api/setup/status` is always available regardless of initialization state. It is the frontend's entry point for deciding what to render.

The three mutation endpoints (`validate-token`, `validate-runtime`, `initialize`) are only usable while the system is uninitialized. After initialization, they return `410 Gone`.

### Setup authorization

Setup endpoints should require a bootstrap secret independent of user login.

Recommended mechanism:

- `OCTOPUS_SETUP_TOKEN` supplied through env for first boot
- token entered by operator in step 1 of the setup wizard
- token sent in request header to setup endpoints

This avoids exposing setup authority to anyone who can merely reach the frontend.

### Workspace writability check

The `GET /api/setup/status` endpoint must verify that the workspace volume is writable and report the result in its response. The frontend should check this before allowing the operator to begin the wizard. This prevents the operator from filling out 4 steps of setup only to discover the volume is read-only at submission time.

### Concurrent setup protection

The `POST /api/setup/initialize` endpoint must acquire an exclusive in-memory lock before writing persistent config. If a concurrent attempt arrives while initialization is in progress, return `409 Conflict`. The lock is released after the write completes or fails. No filesystem lock file is needed because the gateway is single-process.

### One-time semantics

After initialization succeeds:

- mutation setup endpoints (`validate-token`, `validate-runtime`, `initialize`) permanently return `410 Gone` — this is the real security boundary
- setup token is no longer sufficient to modify runtime or users
- normal auth takes over
- the gateway clears `OCTOPUS_SETUP_TOKEN` from `process.env` as best-effort memory hygiene, but this is not a durable security guarantee since container restart re-injects env vars; the 410 guard is what protects the system

V1 does not need a browser-based "factory reset" flow.

## Secret Handling

### Runtime API key

The runtime API key should be entered once during setup and stored in persistent config under the workspace volume.

It should not need to remain in `.env` for the standard single-tenant product path.

### Gateway bootstrap API key

The internal gateway bootstrap key should be generated automatically during initialization.

Rationale:

- it is infrastructure-facing, not user-facing
- automatic generation removes one more manual secret from the operator
- browser users do not need to know it

If CLI/admin workflows need it later, provide an explicit admin recovery/export path rather than requiring it during first-run setup.

### User passwords

Passwords should be entered in plaintext only during setup or login submission.

The backend should:

- generate `scrypt` hashes server-side
- persist only hashed values
- never require the operator to hand-assemble `OCTOPUS_USERS_JSON`

## Docker And Compose Design

### Default compose posture

The bundled compose file should:

- publish the web container
- keep the gateway internal to the compose network
- mount a named volume to `/workspace`

Recommended default:

- `octopus-data:/workspace`

### Advanced override posture

For operators who need host filesystem access, provide a documented compose override or alternate release file that bind-mounts a host path.

That path should be treated as an operations override, not the standard product path.

## CLI Role After This Change

The CLI remains important, but it is no longer the normal first-run product surface.

CLI should serve:

- advanced operations
- automation
- backup and recovery
- future non-interactive bootstrap
- password hash generation (`octopus release hash-password`)

Recommended future fallback:

- `octopus release init --non-interactive`
- `octopus release verify`
- `octopus release up`
- `octopus release add-user`
- `octopus release hash-password`

That fallback exists for automation and headless environments, not because the standard product path is weak.

## Config Loading Architecture

The CLI `gateway run` command is the config assembler. The gateway itself does not read config files at startup.

Startup flow:

1. CLI reads env vars and file-based config as it does today
2. CLI checks for persistent system config at `/workspace/.octopus/system/`
3. if persistent config exists, CLI loads `runtime.json` and `auth.json` and merges them into `LocalAppConfig`, overriding env vars
4. if persistent config does not exist, CLI checks for legacy env vars and applies the priority rule from the migration section
5. CLI constructs `GatewayConfig` and passes it to `GatewayServer`

The gateway accepts a `systemConfigPath` option so it knows where to write persistent config during setup, but it does not independently read config at startup.

### Setup-mode startup

When the system is uninitialized and no legacy env provides runtime config:

- the CLI must generate a temporary internal gateway API key at startup (random UUID), so `assertGatewayConfig()` passes and the HTTP server can start
- the CLI constructs a minimal `LocalAppConfig` with a placeholder `ModelClient` that rejects all calls, no users, and setup-mode flags
- the gateway starts and serves only: `GET /health`, `GET /api/setup/status`, and the three setup mutation endpoints
- all normal auth and task routes return `503 Service Unavailable` with a message indicating setup is required

This means the Docker container always starts successfully, even without any runtime env. The operator opens the browser and sees the setup wizard.

### Runtime hot-swap after initialization

After the setup wizard writes persistent config, the gateway must become fully operational without a container restart. This requires rebuilding the runtime stack in-process:

1. `handleInitialize` writes persistent config to disk
2. the gateway reads back the new config
3. the gateway constructs a new `ModelClient`, `EmbeddedRuntime`, `ExecutionSubstrate`, `WorkEngine`, and `SecurityPolicy` from the new config
4. the gateway replaces its live references to `engine`, `runtime`, `policy`, and related dependencies
5. the gateway updates auth config (apiKey, users, permissions) and clears stale tokens
6. the gateway flips its internal state from setup-mode to production-mode

The `GatewayServer` constructor already takes `private` (not `readonly`) references to engine, runtime, store, etc. This means the hot-swap is architecturally feasible — the server just reassigns these fields.

The only component that does NOT need rebuilding is `StateStore`, because it is independent of runtime config.

If full hot-swap proves too complex for V1, an acceptable fallback is: the initialize endpoint writes config, returns success, and the frontend shows "Initialization complete. The system is restarting." followed by a gateway self-restart (e.g. `process.exit(0)` with Docker `restart: unless-stopped`). This is simpler but slightly worse UX.

## Backward Compatibility And Migration

The current env-driven release path already exists and should not be broken abruptly.

### Config priority rule

The gateway startup path must follow this exact priority order:

1. if `/workspace/.octopus/system/meta.json` exists and contains `initialized: true`, the system is `ready` and loads config from persistent system files (`runtime.json`, `auth.json`). Env vars for runtime/users are ignored.
2. if `meta.json` does not exist but a complete set of legacy env vars is present, the system operates in **legacy mode**: it behaves as `ready`, uses env-provided config directly, and logs a deprecation warning at startup recommending browser-based setup for future deployments. A complete legacy set means both auth config (`OCTOPUS_USERS_JSON` or `OCTOPUS_GATEWAY_API_KEY`) AND runtime config (`OCTOPUS_API_KEY` and `OCTOPUS_MODEL`) are present. If only one side is configured, the system still enters setup mode to avoid a half-ready state where login works but task submission fails.
3. if `meta.json` does not exist and no complete legacy env set is present, the system is `uninitialized` and enters setup mode.

This allows existing deployments to keep working while new deployments use the browser wizard.

### Migration strategy

1. docs should move the standard operator path to browser-first setup
2. legacy env-first bootstrap remains functional but deprecated
3. a future `octopus release migrate` command can convert legacy env config to persistent system config

This allows a controlled move from manual env provisioning to productized bootstrap.

## Post-Initialization Operations

### API key rotation

V1 does not provide a browser-based config editor for runtime settings. To rotate the runtime API key after initialization:

1. edit `/workspace/.octopus/system/runtime.json` inside the workspace volume (or via `docker exec`)
2. restart the gateway container

A future admin settings page can replace this manual step.

### User management after setup

V1 does not provide browser-based user management after the initial setup wizard. To add or modify users:

1. edit `/workspace/.octopus/system/auth.json` inside the workspace volume
2. use `octopus release hash-password` to generate scrypt hashes for new passwords
3. restart the gateway container

A future `octopus release add-user` CLI command or browser admin page can replace this.

## Non-Goals

This design does not add:

- multi-tenant onboarding
- self-serve user management after setup
- browser-based reset or destructive reinstall
- external secret manager integration
- SSO or enterprise identity integration
- per-project runtime profiles

Those can be layered on later.

## Success Criteria

This design is successful when all of the following are true:

1. a fresh Docker deployment can be made usable without editing source code
2. the operator does not manually generate `OCTOPUS_USERS_JSON`
3. the operator does not manually generate `OCTOPUS_GATEWAY_API_KEY`
4. the first frontend interaction is setup when uninitialized, not a broken login
5. after initialization, the frontend supports normal task submission and monitoring
6. configuration and task history survive container restart because they live in persistent storage
7. the standard install story fits this sentence:

> deploy, initialize, log in, use the frontend

## Final Recommendation

The final product recommendation for V1 single-tenant delivery is:

- use Docker to deploy the stack
- use a browser-first setup wizard as the standard initialization path
- use a named Docker volume as the default persistence strategy
- move runtime secrets, generated internal secrets, and user hashes into persistent system config
- reserve env for minimal infrastructure bootstrap values only
- keep CLI bootstrap as a secondary automation path, not the primary operator workflow

This is the cleanest path to the user-visible result that matters:

> after Docker deployment, Octopus has a real frontend for task initiation and task monitoring, with one explicit initialization step that makes the whole system usable.
