# Contributing

## Prerequisites

- Node.js 20 or newer
- pnpm 10 or newer

## Setup

1. Clone the repository.
2. Run `pnpm install` from the repo root.

## Development

- Run tests: `pnpm test`
- Run type checks: `pnpm run type-check`
- Run lint: `pnpm run lint`
- Check formatting: `pnpm exec prettier --check .`

## Project Structure

- `packages/work-contracts`: shared work/session/action types and factories
- `packages/observability`: event contracts, event bus, trace readers and writers
- `packages/agent-runtime`: runtime interfaces and snapshot protocol
- `packages/exec-substrate`: local file/search/shell execution layer
- `packages/state-store`: file-backed sessions and snapshots
- `packages/security`: security profiles and policy evaluation
- `packages/work-core`: orchestration loop, verification, artifacts
- `packages/runtime-embedded`: model-backed embedded runtime
- `packages/runtime-remote`: remote runtime client
- `packages/automation`: cron and watcher automation sources
- `packages/gateway`: HTTP and WebSocket gateway
- `packages/adapter-mcp`: MCP compatibility layer
- `packages/surfaces-cli`: CLI surface
- `packages/surfaces-chat`: Slack chat surface
- `packages/surfaces-web`: Preact web surface

## Branches and Commits

- Use feature branches named `feature/<name>`.
- Prefer commit prefixes: `feat`, `fix`, `docs`, `refactor`, `chore`.

## Reviews

- Open a code review before merging to the main branch.
- Do not merge without at least one review.
- Include verification notes for tests, type-checking, and linting in the review.
