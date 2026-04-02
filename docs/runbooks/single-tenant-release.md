# Single-Tenant Release Runbook

## Runtime Assumptions

- Node.js 20.19+ or 22.x for local runs
- Docker Engine for containerized runs
- one shared workspace mounted at `/workspace`
- `.octopus/` data persisted inside that workspace mount
- reverse proxy or the bundled `web` container terminates browser traffic and forwards `/auth`, `/api`, `/ws`, and `/health` to the gateway

## Required Environment

Copy `.env.example` to `.env` and set:

- `OCTOPUS_MODEL`
- `OCTOPUS_API_KEY`
- `OCTOPUS_ALLOW_MODEL_API_CALL=true`
- `OCTOPUS_GATEWAY_API_KEY`
- `OCTOPUS_USERS_JSON`

`OCTOPUS_USERS_JSON` must contain pre-generated `scrypt$16384$8$1$...$...` hashes. The gateway does not expose self-serve account management.

## Start

```bash
cp .env.example .env
mkdir -p workspace
docker compose -f docker-compose.release.yml up --build -d
```

Endpoints:

- web console: `http://localhost:${OCTOPUS_WEB_PORT:-8080}`
- gateway health: `http://localhost:${OCTOPUS_WEB_PORT:-8080}/health`

## Stop

```bash
docker compose -f docker-compose.release.yml down
```

## Restart

```bash
docker compose -f docker-compose.release.yml down
docker compose -f docker-compose.release.yml up -d
```

## Rotate Credentials

1. Update `.env` with a new `OCTOPUS_GATEWAY_API_KEY` and/or new `OCTOPUS_USERS_JSON` hashes.
2. Restart the stack.
3. Expect browser sessions to be invalidated because session tokens are in-memory.

## Inspect Failed Tasks

1. Open the task in the web console.
2. Inspect blocked reason, artifacts, checkpoints, and recent activity.
3. If needed, open the mounted workspace and inspect `.octopus/sessions`, `.octopus/snapshots`, and `.octopus/traces`.

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
tar -czf octopus-backup.tgz workspace/.octopus
```

Restore:

```bash
tar -xzf octopus-backup.tgz -C workspace
```

## Troubleshooting

- `Authentication required.`: confirm the browser is using `/auth/login` and not the bootstrap API key route.
- `Invalid username or password.`: re-check the `scrypt` hash in `OCTOPUS_USERS_JSON`.
- no tasks visible after restart: confirm the workspace mount still contains `.octopus/`.
- UI loads but API fails: confirm nginx is proxying `/auth`, `/api`, `/ws`, and `/health` to the gateway service.
