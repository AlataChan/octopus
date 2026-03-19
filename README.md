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
|  CLI | Web UI | Chat (Slack)                      |
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
|  embedded (Claude API) | remote (WebSocket)       |
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
| `runtime-embedded` | Claude API runtime adapter |
| `runtime-remote` | WebSocket-based remote runtime adapter |
| `automation` | Cron scheduler, file watcher, event injection |
| `gateway` | HTTP/WebSocket server, auth, event streaming |
| `adapter-mcp` | Optional MCP compatibility layer |
| `surfaces-cli` | CLI: run / status / sessions / replay / mcp / remote |
| `surfaces-web` | Preact browser operator dashboard |
| `surfaces-chat` | Slack adapter (goal intake + completion notification) |

## Quick Start

```bash
# Prerequisites: Node.js >= 20, pnpm >= 10
git clone <repo-url> octopus
cd octopus
pnpm install

# Run tests
pnpm test

# Type check
pnpm run type-check

# Start a work session (requires API key configuration)
npx octopus run "describe your goal here"
```

## Configuration

Workspace configuration lives in `.octopus/config.json`:

```json
{
  "runtime": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
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
```

## License

MIT
