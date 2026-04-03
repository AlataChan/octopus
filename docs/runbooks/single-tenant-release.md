# Single-Tenant Release Runbook

## Runtime Assumptions

- Node.js 20.19+ or 22.x for local runs
- Docker Engine for containerized runs
- one shared named volume mounted at `/workspace`
- `.octopus/` state, system config, sessions, snapshots, and traces persisted inside that volume
- reverse proxy or the bundled `web` container terminates browser traffic and forwards `/auth`, `/api`, `/ws`, and `/health` to the gateway

## Required Environment

Copy `.env.example` to `.env` and set:

- `OCTOPUS_SETUP_TOKEN`

Optional infrastructure overrides:

- `OCTOPUS_WEB_PORT`

`OCTOPUS_SETUP_TOKEN` is only used by the browser setup wizard before initialization completes. After the first successful setup, the gateway switches to persistent system config under `/workspace/.octopus/system`.

## Start

```bash
cp .env.example .env
docker compose -f docker-compose.release.yml up --build -d
```

Endpoints:

- web console: `http://localhost:${OCTOPUS_WEB_PORT:-8080}`
- gateway health: `http://localhost:${OCTOPUS_WEB_PORT:-8080}/health`

## First Browser Initialization

1. Open the web console in a browser.
2. Enter the `OCTOPUS_SETUP_TOKEN` value from `.env`.
3. Configure the runtime:
   - model ID
   - model API key
   - optional OpenAI-compatible base URL
4. Create the first browser admin account.
5. Optionally add viewer/operator accounts.
6. Finish initialization, then sign in with the admin account you just created.

Notes:

- The setup token becomes unusable after initialization completes.
- The runtime and browser accounts are persisted under `/workspace/.octopus/system`.
- No `OCTOPUS_MODEL`, `OCTOPUS_API_KEY`, `OCTOPUS_GATEWAY_API_KEY`, or `OCTOPUS_USERS_JSON` values are required in `.env` for the release path anymore.

## Stop

```bash
docker compose -f docker-compose.release.yml down
```

## Restart

```bash
docker compose -f docker-compose.release.yml down
docker compose -f docker-compose.release.yml up -d
```

## Re-Run Initialization

1. Stop the stack.
2. Remove the named workspace volume:

```bash
docker compose -f docker-compose.release.yml down -v
```

3. Update `.env` with a new `OCTOPUS_SETUP_TOKEN` if needed.
4. Start the stack again.
5. Complete the browser setup wizard from scratch.

## Inspect Failed Tasks

1. Open the task in the web console.
2. Inspect blocked reason, artifacts, checkpoints, and recent activity.
3. If needed, open a shell inside the gateway container and inspect `/workspace/.octopus/sessions`, `/workspace/.octopus/snapshots`, and `/workspace/.octopus/traces`.

```bash
docker compose -f docker-compose.release.yml exec gateway sh
```

## Restore From Checkpoints

- Browser path: use the checkpoint card in the session detail and trigger rollback.
- CLI path:

```bash
node packages/surfaces-cli/dist/index.js checkpoints <session-id>
node packages/surfaces-cli/dist/index.js rollback <session-id> [snapshot-id] --profile vibe
```

## Backup And Restore

Backup:

```bash
docker compose -f docker-compose.release.yml exec gateway tar -czf /tmp/octopus-backup.tgz -C /workspace .octopus
docker compose -f docker-compose.release.yml cp gateway:/tmp/octopus-backup.tgz ./octopus-backup.tgz
```

Restore:

```bash
docker compose -f docker-compose.release.yml cp ./octopus-backup.tgz gateway:/tmp/octopus-backup.tgz
docker compose -f docker-compose.release.yml exec gateway tar -xzf /tmp/octopus-backup.tgz -C /workspace
```

## Troubleshooting

- `Authentication required.`: confirm the browser is using `/auth/login` and not the bootstrap API key route.
- `Valid setup token required.`: confirm the browser setup wizard is using the exact `OCTOPUS_SETUP_TOKEN` from `.env`.
- `Invalid username or password.`: re-check the persisted `/workspace/.octopus/system/auth.json` user entries.
- no tasks visible after restart: confirm the named volume still contains `/workspace/.octopus/`.
- UI loads but API fails: confirm nginx is proxying `/auth`, `/api`, `/ws`, and `/health` to the gateway service.
