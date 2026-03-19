# Octopus Task-Centered Web Closure Design

Date: 2026-03-20
Status: Draft for cross-review
Scope: `packages/surfaces-web`, selected `packages/gateway` routes, selected `packages/state-store` / `packages/work-contracts` contract updates

## Why This Exists

The current browser UI is visually much stronger than before, but it still behaves more like an operator monitor than a task product. That mismatch shows up in four concrete ways:

1. The left rail is session-ID-first instead of task-first.
2. Artifacts are listed but not actually actionable in the browser.
3. The generic "resume" control implies a working recovery path that does not currently exist.
4. The UI does not teach the user how to submit a task that Octopus can realistically complete.

If we want to validate whether Octopus can complete real tasks end-to-end, the web surface needs a task-centered workflow, not just a session viewer.

## Current Findings

### 1. The left rail is developer-readable, not user-readable

`SessionList.tsx` currently renders `session.id` as the primary line and `goalId` as secondary metadata. This exposes internal identifiers instead of the user's task concept.

The backend and storage layers already carry `namedGoalId?`, but the browser does not prioritize it.

### 2. Artifact rows are labels, not actions

The artifact module currently renders:

- path on the left
- artifact type chip on the right

The right-side chip is not a button. It only indicates `document`, `report`, `runbook`, and so on. From a user perspective this looks clickable but does nothing.

### 3. Resume semantics are not trustworthy

`POST /api/sessions/:id/control { action: "resume" }` currently does not re-enter the work loop. It only:

- calls `runtime.resumeSession(sessionId)`
- sets `session.state = "active"`
- persists the session

In `runtime-embedded`, `resumeSession()` is a no-op. This means the browser "continue" button suggests a recovery workflow that the product does not actually implement.

### 4. The browser has no task creation UX

The web client has `submitGoal()` in the API client, but there is no browser composer for:

- task title / alias
- task instructions
- success criteria guidance
- example tasks

As a result, the browser cannot yet serve as the main place to validate real task execution.

## Product Direction

The next web iteration should shift from:

- session monitor

to:

- task-centered operator console

This does not mean turning the UI into chat. It means:

- users start from a task
- sessions become execution records of that task
- blocked states explain what intervention is needed
- artifacts become consumable outputs

## Recommended Decisions

### Decision 1: Use task naming as the primary sidebar label

The left rail should show task identity, not raw session identity.

Recommended display order:

1. `namedGoalId` if provided
2. persisted `goalSummary` derived from the goal description
3. short `sessionId` only as fallback

Session ID should remain available, but as a secondary technical field inside the detail panel or a copy affordance.

The browser composer should treat task title as visually optional, not required. If the user leaves it blank:

- the browser may derive a temporary local preview title from the task instruction before submission succeeds
- the fallback should preserve the user's original language where possible
- the fallback should be a short human-readable title, not a slugified `clean-up-temp-directory` style identifier

For persisted sessions, the durable human-readable fallback should be `goalSummary`, not a separate stored display-title field. This keeps task creation low-friction while ensuring the left rail remains understandable after refresh.

### Decision 2: Add a browser task composer

The browser should support submitting a new task directly instead of relying on CLI-only creation.

Recommended fields:

- task title
  - stored as `namedGoalId`
- task instruction
  - stored as goal `description`

Optional later fields:

- constraints
- expected output path

For the first closure pass, title + instruction is enough.

### Decision 3: Add lightweight task-writing guidance

Yes, the UI should include user-facing task instruction, but only at the point of task creation or empty state.

It should not be a long tutorial block permanently pinned to the dashboard.

Recommended instruction pattern:

- one-sentence rule
  - "Describe what to do, what to output, and any constraints."
- two short examples
- one warning
  - "Vague tasks are likely to block or fail verification."

This guidance should live in:

- the task composer
- the empty state when no sessions exist

It should not dominate the session detail page after a task is already running.

### Decision 4: Replace generic "resume" with state-aware intervention actions

The browser should not expose a generic continue button until there is a real end-to-end resume model.

Recommended near-term behavior:

- `Pause`
  - keep
- `Cancel`
  - keep
- `Continue`
  - remove or disable behind an explicit "not yet supported" explanation

Blocked sessions should instead show one of these intervention states:

1. `Approval required`
   - use approve / deny controls
2. `Clarification required`
   - show the question and collect a user response in a future phase
3. `Verification failed`
   - show the reason and suggest rerun / inspect artifacts / submit a follow-up task
4. `Paused by operator`
   - only this case is a valid candidate for future resume support

The critical product rule is:

- no control should imply recoverability that the backend does not implement

### Decision 5: Make artifacts actionable

Artifacts should not appear as inert rows. The browser should support:

- preview text/markdown artifacts
- open raw content in a modal
- copy artifact path

The artifact preview should use a large centered modal on desktop and a full-screen overlay on smaller screens. It should not reuse the existing right-side inspector rail, which is already reserved for gateway and system status.

Recommended first pass:

- support text-like artifacts only
  - `document`, `report`, `runbook`, `patch`, `code`, `script`
- show a disabled or secondary state for unsupported artifact types

This likely requires a gateway read endpoint for artifact content, because the browser cannot directly open workspace files from the local filesystem.

### Decision 6: Explain why a session is blocked

A blocked state without a visible reason is not usable.

The detail panel should include a dedicated intervention card when the selected session is blocked. The source of truth can be:

- latest transition reason from `session.transitions`
- approval payload when present
- latest relevant event where needed

The card should answer:

- what happened
- what the user can do next
- whether Octopus is waiting for approval, clarification, or manual inspection

The blocked card should be visually high-signal. It should use warning / intervention styling strong enough to immediately pull operator attention without overwhelming the rest of the dashboard.

## UX Structure

### Header

- product identity
- connection state
- existing language switch
- new task button

### Left Rail

- task-first session list
- primary title = `namedGoalId ?? goalSummary ?? shortSessionId`
- secondary line = `goalSummary` only when `namedGoalId` exists and summary text adds differentiation
- state chip
- latest update time
- fallback technical ID in smaller text if needed

### Main Column

When no task is selected:

- task composer
- short task-writing guidance
- example tasks

When a task is selected:

- task summary
- blocked / intervention card if relevant
- work items
- artifacts with preview/open actions
- recent activity

### Right Rail / Inspector

Keep as system status and raw gateway inspection, not task authoring.

## Data and Contract Changes

### Needed in the browser contract

Recommended `SessionSummary` display fields:

- `namedGoalId?: string`
- `goalSummary?: string`
- `updatedAt`
- current `state`

Recommended supporting session field:

- `WorkSession.goalSummary?: string`

`goalSummary` is recommended for Phase A, not as a cosmetic extra but as a contract change that materially improves left-rail scanability. It should be derived from the task instruction / goal description and truncated for list display.

This is not currently available from persisted session data alone. The implementation should explicitly account for where that summary is sourced and persisted rather than treating it as a trivial UI-only addition.

Recommended implementation path:

- derive `goalSummary` once at session creation time in `work-core` from `goal.description`
- keep the rule simple and language-preserving
  - trim whitespace
  - truncate to a short display length suitable for the rail, for example about 60 characters
- persist it on `WorkSession`
- carry it through `state-store`
- expose it on `SessionSummary` through the existing sessions route
- tolerate older stored sessions that do not yet have the field

Phase A should not introduce a separate stored `displayTitle` contract. `goalSummary` is the durable fallback human-readable text when `namedGoalId` is absent.

### Needed in task submission

Use the existing gateway route to submit:

- `description`
- `namedGoalId`

No new API is required for the basic composer.

### Needed for artifact preview

Add a gateway endpoint to fetch artifact content for a session-scoped artifact path.

Recommended shape:

- `GET /api/sessions/:id/artifacts/content?path=...`

Scope rules:

- text-like artifacts only in the first pass
- return content type and body
- validate that the requested `path` matches an artifact already registered on the target session before reading
- resolve the path against the workspace root and normalize it to prevent traversal outside the workspace
- reject unknown or unsafe paths

## What To Do About Resume

True resume is a deeper domain problem, not just a browser problem.

Right now the system lacks a complete browser-safe recovery model because:

- runtime `resumeSession()` is a no-op
- gateway `resume` does not re-enter `WorkEngine.runLoop()`
- the durable state model is not yet shaped around operator-driven continuation after blocked states

Recommendation:

- do **not** try to "fix resume" in the same closure phase as task creation and artifact preview
- remove or disable the browser continue button now
- revisit resume as a dedicated design slice after the task-centered web flow is usable

This avoids shipping a misleading control while letting the product become genuinely testable for real tasks.

## Recommended Delivery Scope

### Phase A: Make the browser usable for real task trials

1. Add task composer with title + instruction.
2. Treat title as optional and allow a temporary local preview title when blank before submission completes.
3. Show task title (`namedGoalId` or persisted `goalSummary`) as the primary session label.
4. Add `goalSummary` to session summaries for better task differentiation.
5. Add empty-state task guidance and examples.
6. Add blocked reason card with strong intervention styling.
7. Remove or disable generic continue.
8. Add artifact preview/open for text-like outputs using a modal.

Phase A should retain the existing language switch in the header, but it does not need a separate i18n expansion task.

### Phase B: Deep workflow completion

1. Add clarification response workflow.
2. Add richer task metadata in session summaries.
3. Design true operator resume semantics if still needed.

## Non-Goals For Phase A

1. Do not build a chat UI.
2. Do not solve full general-purpose resume in this pass.
3. Do not add a large form schema for tasks.
4. Do not add broad file-system browsing in the browser.

## Resolved Cross-Review Outcomes

1. `namedGoalId` should be optional in the browser composer; before submission completes the browser may show a temporary readable title, while persisted sessions should fall back to `goalSummary`.
2. `goalSummary` is worth adding in Phase A, but it must be treated as an explicit contract/data-model change rather than a trivial UI truncation.
3. Artifact preview should use a modal / overlay, not the existing right-side inspector rail.
4. The browser `continue` control should be removed or disabled before any resume redesign.
5. The browser should become a peer entry point for task creation and operation, not a replacement for CLI or API-first usage.

## Recommended Verdict

Proceed with Phase A as the next product slice.

It addresses the user's real pain:

- "What are these sessions?"
- "Why can't I open the artifacts?"
- "Why does continue not work?"
- "How do I submit a task that can actually finish?"

It also avoids the trap of patching a misleading `resume` control before the underlying execution model is ready.
