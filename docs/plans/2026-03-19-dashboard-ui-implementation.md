# Dashboard UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform `packages/surfaces-web` into a dashboard-style operator UI while adding lightweight automated test coverage for the web surface.

**Architecture:** Keep the existing three-zone application shell and the current data flow in `App.tsx`, but strengthen hierarchy with a summary band, denser session rail, clearer session modules, and a structured status inspector. Derive all new dashboard metrics from existing `sessions`, `selectedSession`, `approval`, and `status` state rather than adding new API calls or a state library. Keep the inspector model aligned with the existing `showStatus` toggle: desktop uses a third-column right rail, mobile uses an inline collapsible section, and `ApprovalDialog` / `EventStream` / `ControlBar` are explicitly part of the redesign.

**Tech Stack:** Preact 10, Vite 7, TypeScript 5, Vitest 3, `@testing-library/preact`, `@testing-library/jest-dom`, `jsdom`, existing `@octopus/work-contracts` and `@octopus/observability` types.

**Precondition:** Execute this plan from a dedicated git worktree before making code changes.

---

### Task 1: Add Web Test Harness

**Files:**
- Create: `packages/surfaces-web/src/test/setup.ts`
- Create: `packages/surfaces-web/src/__tests__/smoke.test.tsx`
- Modify: `packages/surfaces-web/package.json`
- Modify: `vitest.config.ts`

**Step 1: Write the failing test**

Create `packages/surfaces-web/src/__tests__/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { LoginForm } from "../components/LoginForm.js";

describe("surfaces-web smoke", () => {
  it("renders the login prompt", () => {
    render(<LoginForm onLogin={async () => undefined} />);

    expect(screen.getByRole("heading", { name: "Octopus" })).toBeInTheDocument();
    expect(screen.getByText("API Key")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --project surfaces-web
```

Expected: FAIL because the `surfaces-web` project is not yet defined in `vitest.config.ts` and the testing-library packages are not installed.

**Step 3: Write minimal implementation**

Update `vitest.config.ts` by adding a `surfaces-web` project with `jsdom` and a setup file:

```ts
{
  test: {
    name: "surfaces-web",
    include: ["packages/surfaces-web/src/**/*.test.ts", "packages/surfaces-web/src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["packages/surfaces-web/src/test/setup.ts"]
  }
}
```

Update `packages/surfaces-web/package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "type-check": "tsc --noEmit -p tsconfig.json",
    "test": "pnpm --dir ../../ exec vitest run --config vitest.config.ts --project surfaces-web"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.10.2",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/preact": "^3.2.4",
    "jsdom": "^26.1.0",
    "vite": "^7.2.0"
  }
}
```

Create `packages/surfaces-web/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: PASS with the smoke test green under the new `surfaces-web` Vitest project.

**Step 5: Commit**

```bash
git add vitest.config.ts packages/surfaces-web/package.json packages/surfaces-web/src/test/setup.ts packages/surfaces-web/src/__tests__/smoke.test.tsx
git commit -m "test: add surfaces-web vitest harness"
```

### Task 2: Build the Dashboard Shell and Summary Band

**Files:**
- Create: `packages/surfaces-web/src/__tests__/fixtures.ts`
- Create: `packages/surfaces-web/src/__tests__/app.test.tsx`
- Modify: `packages/surfaces-web/src/App.tsx`
- Modify: `packages/surfaces-web/src/components/ConnectionStatus.tsx`
- Modify: `packages/surfaces-web/src/styles/index.css`

**Step 1: Write the failing test**

Create `packages/surfaces-web/src/__tests__/fixtures.ts`:

```ts
import type { WorkEvent } from "@octopus/observability";
import { createWorkGoal, createWorkSession, type SessionSummary, type WorkSession } from "@octopus/work-contracts";

import type { ApprovalRequest, StatusResponse } from "../api/client.js";

const now = new Date("2026-03-19T15:42:36.000Z");

export function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? "session-1",
    goalId: overrides.goalId ?? "goal-1",
    state: overrides.state ?? "active",
    updatedAt: overrides.updatedAt ?? now,
    namedGoalId: overrides.namedGoalId
  };
}

export function makeWorkSession(overrides: Partial<WorkSession> = {}): WorkSession {
  const goal = createWorkGoal({
    id: overrides.goalId ?? "goal-1",
    description: "Use MCP",
    createdAt: now
  });
  const session = createWorkSession(goal, {
    id: overrides.id ?? "session-1",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  });

  return {
    ...session,
    state: overrides.state ?? "blocked",
    items: overrides.items ?? [],
    observations: overrides.observations ?? [],
    artifacts: overrides.artifacts ?? [],
    transitions: overrides.transitions ?? [],
    namedGoalId: overrides.namedGoalId
  };
}

export function makeStatus(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    profile: overrides.profile ?? "vibe",
    apiKeyConfigured: overrides.apiKeyConfigured ?? true,
    tlsEnabled: overrides.tlsEnabled ?? false,
    trustProxyCIDRs: overrides.trustProxyCIDRs ?? [],
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? 4321,
    allowRemote: overrides.allowRemote ?? true,
    activeSessionCount: overrides.activeSessionCount ?? 2,
    connectedClients: overrides.connectedClients ?? 1
  };
}

export function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    promptId: overrides.promptId ?? "prompt-1",
    description: overrides.description ?? "Approve shell command execution",
    riskLevel: overrides.riskLevel ?? "high"
  };
}

export function makeEvent(overrides: Partial<WorkEvent> = {}): WorkEvent {
  return {
    id: overrides.id ?? "evt-1",
    sessionId: overrides.sessionId ?? "session-1",
    goalId: overrides.goalId ?? "goal-1",
    type: overrides.type ?? "session.blocked",
    sourceLayer: overrides.sourceLayer ?? "gateway",
    timestamp: overrides.timestamp ?? now,
    payload: overrides.payload ?? { reason: "Awaiting approval" }
  } as WorkEvent;
}
```

Create `packages/surfaces-web/src/__tests__/app.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeSessionSummary, makeStatus, makeWorkSession } from "./fixtures.js";

const { listSessions, getSession, getStatus, connectEventStream } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  getStatus: vi.fn(),
  connectEventStream: vi.fn(() => ({ detach: vi.fn() }))
}));

vi.mock("../api/client.js", () => {
  class FakeGatewayClient {
    isAuthenticated() {
      return true;
    }
    async login() {}
    logout() {}
    listSessions = listSessions;
    getSession = getSession;
    getStatus = getStatus;
    connectEventStream = connectEventStream;
    async controlSession() {}
    async approvePrompt() {}
  }

  return { GatewayClient: FakeGatewayClient };
});

import { App } from "../App.js";

describe("App dashboard shell", () => {
  beforeEach(() => {
    listSessions.mockResolvedValue([
      makeSessionSummary({ id: "session-1", state: "active" }),
      makeSessionSummary({ id: "session-2", state: "blocked" }),
      makeSessionSummary({ id: "session-3", state: "completed" })
    ]);
    getSession.mockResolvedValue(makeWorkSession({ id: "session-1", state: "blocked" }));
    getStatus.mockResolvedValue(makeStatus());
  });

  it("renders derived summary metrics and toggles the inspector", async () => {
    render(<App />);

    expect(await screen.findByText("Total Sessions")).toBeInTheDocument();
    const totalCard = screen.getByText("Total Sessions").closest("article");
    expect(totalCard).not.toBeNull();
    expect(within(totalCard as HTMLElement).getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /status/i }));

    expect(await screen.findByText("Gateway Status")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: FAIL because `App.tsx` does not yet render the summary band or the redesigned status inspector heading.

**Step 3: Write minimal implementation**

Update `packages/surfaces-web/src/App.tsx` to:

- derive counts from `sessions`
- add a dashboard header subtitle
- render a summary band above the three-column layout
- keep `showStatus` as the inspector toggle

Minimal derivation logic:

```ts
const summary = sessions.reduce(
  (current, session) => {
    current.total += 1;
    if (session.state === "active") current.active += 1;
    if (session.state === "blocked") current.blocked += 1;
    if (session.state === "completed") current.completed += 1;
    return current;
  },
  {
    total: 0,
    active: 0,
    blocked: 0,
    completed: 0,
    items: selectedSession?.items.length ?? 0,
    artifacts: selectedSession?.artifacts.length ?? 0
  }
);
```

Render a summary band in `App.tsx`:

```tsx
<section class="summary-band" aria-label="Dashboard Summary">
  <article class="summary-card"><span>Total Sessions</span><strong>{summary.total}</strong></article>
  <article class="summary-card"><span>Active</span><strong>{summary.active}</strong></article>
  <article class="summary-card"><span>Blocked</span><strong>{summary.blocked}</strong></article>
  <article class="summary-card"><span>Completed</span><strong>{summary.completed}</strong></article>
  <article class="summary-card"><span>Selected Items</span><strong>{summary.items}</strong></article>
  <article class="summary-card"><span>Artifacts</span><strong>{summary.artifacts}</strong></article>
</section>
```

Update `packages/surfaces-web/src/components/ConnectionStatus.tsx` to make the connection badge and actions more compact and dashboard-like without changing its behavior.

Update `packages/surfaces-web/src/styles/index.css` with the first round of dashboard shell tokens and layout hooks:

```css
:root {
  --bg: #f3f1ec;
  --panel: rgba(255, 255, 255, 0.92);
  --panel-strong: #ffffff;
  --text: #1f2937;
  --muted: #667085;
  --accent: #c96b3b;
  --accent-soft: #f6e5da;
  --border: rgba(31, 41, 55, 0.08);
  --shadow: 0 18px 40px rgba(31, 41, 55, 0.08);
  --radius: 18px;
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: PASS with the App dashboard test and the smoke test both green.

**Step 5: Commit**

```bash
git add packages/surfaces-web/src/__tests__/fixtures.ts packages/surfaces-web/src/__tests__/app.test.tsx packages/surfaces-web/src/App.tsx packages/surfaces-web/src/components/ConnectionStatus.tsx packages/surfaces-web/src/styles/index.css
git commit -m "feat: add dashboard shell and summary band"
```

### Task 3: Redesign the Session Rail

**Files:**
- Create: `packages/surfaces-web/src/__tests__/session-list.test.tsx`
- Modify: `packages/surfaces-web/src/components/SessionList.tsx`
- Modify: `packages/surfaces-web/src/styles/index.css`

**Step 1: Write the failing test**

Create `packages/surfaces-web/src/__tests__/session-list.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { SessionList } from "../components/SessionList.js";
import { makeSessionSummary } from "./fixtures.js";

describe("SessionList", () => {
  it("renders compact session metadata and keeps selection behavior", () => {
    const onSelect = vi.fn();
    const onRefresh = vi.fn(async () => undefined);

    render(
      <SessionList
        sessions={[
          makeSessionSummary({ id: "session-alpha", goalId: "goal-alpha", state: "blocked" })
        ]}
        selectedSessionId="session-alpha"
        onSelect={onSelect}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText("goal-alpha")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /session-alpha/i }));

    expect(onSelect).toHaveBeenCalledWith("session-alpha");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: FAIL because the current session rail only renders the raw session id button and does not expose compact metadata or a visible state label.

**Step 3: Write minimal implementation**

Update `packages/surfaces-web/src/components/SessionList.tsx` so each session row becomes a compact rail card:

```tsx
<button
  type="button"
  class={`session-row ${selectedSessionId === session.id ? "selected" : ""}`}
  onClick={() => onSelect(session.id)}
  aria-label={session.id}
>
  <span class="session-row-top">
    <span class={`session-dot is-${session.state}`} />
    <span class="session-id">{session.id}</span>
  </span>
  <span class="session-meta">{session.goalId}</span>
  <span class={`session-state-chip state-${session.state}`}>{session.state}</span>
</button>
```

Update `packages/surfaces-web/src/styles/index.css` with rail-specific rules for:

- compact rail cards
- stronger selected state using the warm accent instead of the old default blue
- metadata line truncation
- state chips

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: PASS with smoke, App, and SessionList tests all green.

**Step 5: Commit**

```bash
git add packages/surfaces-web/src/__tests__/session-list.test.tsx packages/surfaces-web/src/components/SessionList.tsx packages/surfaces-web/src/styles/index.css
git commit -m "feat: redesign dashboard session rail"
```

### Task 4: Redesign Session Detail Modules

**Files:**
- Create: `packages/surfaces-web/src/__tests__/session-detail.test.tsx`
- Modify: `packages/surfaces-web/src/components/SessionDetail.tsx`
- Modify: `packages/surfaces-web/src/components/ControlBar.tsx`
- Modify: `packages/surfaces-web/src/components/ApprovalDialog.tsx`
- Modify: `packages/surfaces-web/src/components/EventStream.tsx`
- Modify: `packages/surfaces-web/src/styles/index.css`

**Step 1: Write the failing test**

Create `packages/surfaces-web/src/__tests__/session-detail.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { SessionDetail } from "../components/SessionDetail.js";
import { makeApproval, makeEvent, makeWorkSession } from "./fixtures.js";

describe("SessionDetail", () => {
  it("renders the redesigned overview, approval, and live activity sections", () => {
    render(
      <SessionDetail
        session={makeWorkSession({
          state: "blocked",
          items: [
            {
              id: "item-1",
              sessionId: "session-1",
              description: "Use MCP",
              state: "active",
              observations: [],
              actions: [],
              verifications: [],
              createdAt: new Date("2026-03-19T15:42:36.000Z")
            }
          ],
          artifacts: [
            {
              id: "artifact-1",
              type: "document",
              path: "PLAN.md",
              description: "Plan document",
              createdAt: new Date("2026-03-19T15:42:36.000Z")
            }
          ]
        })}
        events={[makeEvent()]}
        approval={makeApproval()}
        busy={false}
        onControl={vi.fn(async () => undefined)}
        onResolveApproval={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByRole("heading", { name: "Session Overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pending Approval" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: FAIL because the current detail view does not yet use the new overview / approval / activity section hierarchy.

**Step 3: Write minimal implementation**

Update `packages/surfaces-web/src/components/SessionDetail.tsx` to structure the page into clearer dashboard modules:

```tsx
<section class="card session-overview">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Selected Session</p>
      <h2>Session Overview</h2>
    </div>
    <span class={`status-indicator ${session.state}`}>{session.state}</span>
  </div>
  <div class="session-kv-grid">
    <div><span>Session ID</span><strong>{session.id}</strong></div>
    <div><span>Goal ID</span><strong>{session.goalId}</strong></div>
    <div><span>Created</span><strong>{session.createdAt.toLocaleString()}</strong></div>
    <div><span>Updated</span><strong>{session.updatedAt.toLocaleString()}</strong></div>
  </div>
</section>
```

Update `packages/surfaces-web/src/components/ApprovalDialog.tsx`:

```tsx
<div class="card approval-dialog">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Attention</p>
      <h3>Pending Approval</h3>
    </div>
    <span class="risk-chip">{approval.riskLevel}</span>
  </div>
  <p>{approval.description}</p>
  ...
</div>
```

Update `packages/surfaces-web/src/components/EventStream.tsx`:

```tsx
<section class="card event-stream">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Activity</p>
      <h3>Recent Activity</h3>
    </div>
    <span>{events.length}</span>
  </div>
  ...
</section>
```

Update `packages/surfaces-web/src/components/ControlBar.tsx` to add layout hooks like `control-bar card-inline` and button variants while keeping the exact pause / resume / cancel behavior intact.

Update `packages/surfaces-web/src/styles/index.css` with section layouts, metadata grids, approval emphasis, event row styling, and denser module spacing.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: PASS with smoke, App, SessionList, and SessionDetail tests all green.

**Step 5: Commit**

```bash
git add packages/surfaces-web/src/__tests__/session-detail.test.tsx packages/surfaces-web/src/components/SessionDetail.tsx packages/surfaces-web/src/components/ControlBar.tsx packages/surfaces-web/src/components/ApprovalDialog.tsx packages/surfaces-web/src/components/EventStream.tsx packages/surfaces-web/src/styles/index.css
git commit -m "feat: redesign dashboard session detail modules"
```

### Task 5: Redesign the Status Inspector

**Files:**
- Create: `packages/surfaces-web/src/__tests__/status-panel.test.tsx`
- Modify: `packages/surfaces-web/src/components/StatusPanel.tsx`
- Modify: `packages/surfaces-web/src/styles/index.css`

**Step 1: Write the failing test**

Create `packages/surfaces-web/src/__tests__/status-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { StatusPanel } from "../components/StatusPanel.js";
import { makeStatus } from "./fixtures.js";

describe("StatusPanel", () => {
  it("renders structured inspector fields and a raw JSON disclosure", () => {
    render(<StatusPanel status={makeStatus()} visible />);

    expect(screen.getByRole("heading", { name: "Gateway Status" })).toBeInTheDocument();
    expect(screen.getByText("Connected Clients")).toBeInTheDocument();
    expect(screen.getByText("Raw JSON")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: FAIL because the current status panel only dumps `JSON.stringify(status, null, 2)` inside a `<pre>`.

**Step 3: Write minimal implementation**

Update `packages/surfaces-web/src/components/StatusPanel.tsx`:

```tsx
<aside class="card status-panel">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Inspector</p>
      <h2>Gateway Status</h2>
    </div>
  </div>

  <dl class="status-grid">
    <div><dt>Profile</dt><dd>{status?.profile ?? "Loading..."}</dd></div>
    <div><dt>Host</dt><dd>{status ? `${status.host}:${status.port}` : "Loading..."}</dd></div>
    <div><dt>Connected Clients</dt><dd>{status?.connectedClients ?? "Loading..."}</dd></div>
    <div><dt>Remote Access</dt><dd>{status?.allowRemote ? "Enabled" : "Disabled"}</dd></div>
  </dl>

  <details class="status-raw">
    <summary>Raw JSON</summary>
    <pre>{status ? JSON.stringify(status, null, 2) : "Loading..."}</pre>
  </details>
</aside>
```

Update `packages/surfaces-web/src/styles/index.css` with inspector-specific rules for the grid, disclosure, and desktop/mobile placement.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @octopus/surfaces-web test
```

Expected: PASS with all `surfaces-web` tests green.

**Step 5: Commit**

```bash
git add packages/surfaces-web/src/__tests__/status-panel.test.tsx packages/surfaces-web/src/components/StatusPanel.tsx packages/surfaces-web/src/styles/index.css
git commit -m "feat: redesign dashboard status inspector"
```

## Final Verification

Run the focused checks first:

```bash
pnpm --filter @octopus/surfaces-web test
pnpm --filter @octopus/surfaces-web type-check
pnpm --filter @octopus/surfaces-web build
```

Expected:

- `surfaces-web` tests pass with `0 failed`
- package type-check exits `0`
- Vite build exits `0`

Then run the workspace check affected by the root Vitest config change:

```bash
pnpm test
```

Expected: full workspace Vitest run exits `0` with the new `surfaces-web` project included.

## Notes for the Implementer

- Keep the redesign dashboard-first. Do not drift into a chat-centered layout.
- Do not add routing, a state library, or a UI kit.
- Keep the inspector model fixed: desktop third-column rail, mobile inline collapsible section, no overlay.
- Keep `ApprovalDialog`, `EventStream`, and `ControlBar` in scope for visual redesign only; do not change their interaction semantics.
- Keep CSS variables in `:root` inside `packages/surfaces-web/src/styles/index.css`.
- Reuse `packages/surfaces-web/src/__tests__/fixtures.ts` instead of duplicating fixture builders across test files.
