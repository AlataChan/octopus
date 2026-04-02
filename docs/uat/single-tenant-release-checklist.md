# Single-Tenant Release UAT Checklist

## Authentication

- login as `viewer`
- login as `operator`
- login as `admin`
- logout invalidates the browser session

## Task Publish And Monitoring

- operator can create a task with title and instruction
- viewer cannot see task creation controls
- session list shows task title first
- session detail shows state, artifacts, and recent activity

## Intervention

- blocked clarification renders in the task detail
- operator/admin can answer clarification
- approval cards render only for roles that can act
- operator/admin can pause or cancel a session

## Checkpoints And Audit

- checkpoint list renders for a session with snapshots
- rollback starts a new session from a selected snapshot
- recent activity shows audit events

## System Health

- status panel shows profile, role, signed-in user, browser login state, and audit trace availability
- `/health` returns `status: ok`

## Release Gates

- `pnpm run type-check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `docker build --target gateway-runner -t octopus-gateway .`
- `docker build --target web-runner -t octopus-web .`
