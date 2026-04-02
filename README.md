# Octopus

A local-first, code-native work agent that turns real work goals into executable actions and durable outputs.

## What It Does

Octopus accepts work goals in natural language and translates them into concrete, verifiable actions through code, scripts, tools, APIs, and files.

Typical goals:

- Clean and transform data, then produce a report
- Inspect a repository, diagnose a failure, patch it, and verify the result
- Turn a repeated process into a script and leave behind a reusable runbook
- Gather scattered material, normalize it, and publish a structured knowledge asset
- Monitor a system condition and perform repair or escalation actions

## Architecture

```
+--------------------------------------------------+
|              Surfaces Layer                       |
|  CLI | Web UI | Chat (Webhook / 长链接回调)           |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|           Gateway / Access Layer                  |
|   HTTP, WebSocket (optional, not required)        |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|        Automation / Event Injection               |
|   cron | file watchers                            |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|               Work Core                           |
|  goal intake | work loop | artifact model         |
|  planning | verification | completion             |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|             Agent Runtime                         |
|  OpenAI-compatible (e.g. OpenRouter) | remote      |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|          Execution Substrate                      |
|  read | patch | shell | search | mcp-call         |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|       Workspace / State / Artifacts               |
|  sessions | snapshots | traces | artifacts        |
+--------------------------------------------------+
```

## Packages

| Package | Role |
|---------|------|
| `work-contracts` | Pure domain types (no logic, no deps) |
| `observability` | EventBus + JSONL trace writer/reader |
| `agent-runtime` | Runtime protocol interfaces |
| `exec-substrate` | read / patch / shell / search + MCP extension |
| `state-store` | Session + artifact persistence, snapshot/restore |
| `security` | safe-local / vibe / platform security profiles |
| `work-core` | Work loop engine, verification, completion |
| `runtime-embedded` | OpenAI-compatible runtime adapter (e.g. OpenRouter) |
| `runtime-remote` | Remote runtime adapter |
| `automation` | Cron scheduler, file watcher, event injection |
| `gateway` | HTTP/WebSocket server, auth, event streaming |
| `adapter-mcp` | Optional MCP compatibility layer |
| `surfaces-cli` | CLI: run / status / sessions / replay / mcp / remote |
| `surfaces-web` | Preact browser operator dashboard |
| `surfaces-chat` | Chat adapter via Webhook / 长链接回调 (goal intake + completion notification) |

## Quick Start

```bash
# Prerequisites: Node.js >= 20.19, pnpm >= 10
git clone <repo-url> octopus
cd octopus
pnpm install

# Run tests
pnpm test

# Type check
pnpm run type-check

# Build the CLI bundle
pnpm build

# Configure runtime access
node packages/surfaces-cli/dist/index.js init

# Start a work session
node packages/surfaces-cli/dist/index.js run "describe your goal here"
```

## Single-Tenant Control Console

The release baseline ships a browser control console for one internal team, one shared workspace, and one default model/MCP profile.

Browser login uses static users from `OCTOPUS_USERS_JSON` and short-lived session tokens. The gateway bootstrap API key remains available for CLI/bootstrap flows only.

Relevant browser flows:

- username/password login
- task publish with title + instruction
- blocked-session clarification and approval
- artifact preview
- checkpoint visibility and rollback
- system health, role, and audit visibility

## Release Configuration

The gateway and runtime can be configured from environment variables:

- `OCTOPUS_MODEL`
- `OCTOPUS_API_KEY`
- `OCTOPUS_ALLOW_MODEL_API_CALL=true`
- `OCTOPUS_GATEWAY_API_KEY`
- `OCTOPUS_GATEWAY_HOST`
- `OCTOPUS_GATEWAY_PORT`
- `OCTOPUS_USERS_JSON`

See [`.env.example`](./.env.example) for the full shape.

## Release Deployment

Containerized release path:

```bash
cp .env.example .env
mkdir -p workspace
docker compose -f docker-compose.release.yml up --build -d
```

This starts:

- `gateway`: the Octopus runtime + API service
- `web`: nginx serving the built Preact console and proxying `/auth`, `/api`, `/ws`, and `/health` to the gateway

Runbook:

- [`docs/runbooks/single-tenant-release.md`](./docs/runbooks/single-tenant-release.md)

UAT assets:

- [`docs/uat/single-tenant-release-checklist.md`](./docs/uat/single-tenant-release-checklist.md)
- [`docs/uat/single-tenant-release-signoff.md`](./docs/uat/single-tenant-release-signoff.md)

## Configuration

Workspace configuration lives in `.octopus/config.json`:

```json
{
  "runtime": {
    "provider": "openai-compatible",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-model-id",
    "apiKey": "sk-..."
  },
  "mcp": {
    "servers": [
      {
        "id": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "./data"],
        "defaultToolPolicy": "deny",
        "toolPolicy": {
          "read_file": { "allowed": true, "securityCategory": "read" }
        }
      }
    ]
  }
}
```

## Security Profiles

| Profile | Use Case | Network | MCP | Shell |
|---------|----------|---------|-----|-------|
| `safe-local` | Default interactive use | Denied | Denied | Allowlisted executables |
| `vibe` | Trusted local experimentation | Allowed | Allowed | All allowed |
| `platform` | Remote/shared deployment | Policy file | Policy file | Policy file |

## Key Design Principles

1. **Core Independence** -- Work Core is fully functional without gateway, automation, or surfaces
2. **Evidence Completion** -- Session completion requires artifact + verification evidence
3. **Observability Gate** -- Any behavior must emit observable events, or it is not fully designed
4. **One Runtime Model** -- One AgentRuntime protocol, many adapters
5. **MCP at the Edge** -- MCP is a compatibility layer, not the core's language
6. **Artifact-First Memory** -- The system remembers through durable artifacts, not prompt accumulation

## Development

```bash
# Run all tests
pnpm test

# Type check entire workspace
pnpm run type-check

# Run tests for a single package
pnpm --filter @octopus/work-core test

# Lint
pnpm run lint

# Format check
pnpm run format

# Release gates
pnpm run release:verify
```

## License

MIT
