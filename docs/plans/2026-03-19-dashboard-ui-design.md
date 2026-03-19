# Octopus Web Dashboard UI Redesign

Date: 2026-03-19
Status: Approved design
Scope: `packages/surfaces-web`

## Summary

Redesign the current web surface from a plain card list into a lightweight operator dashboard. The product should remain simple and readable, but it should feel intentional, active, and operational instead of empty or generic.

The redesign should stay dashboard-first, not chat-first. We can borrow layout discipline, density, and control grouping from modern AI control panels, but Octopus should still center on sessions, work state, artifacts, approvals, and live operational visibility.

## Resolved Decisions

### Inspector Visibility Pattern

This is resolved for implementation:

- desktop uses the existing toggle model as a third-column right rail
- mobile and smaller screens use an inline collapsible inspector
- slide-over or overlay inspector patterns are out of scope for this redesign

This keeps the design aligned with the current `showStatus` behavior and avoids introducing a second interaction model.

### Approval and Event Modules

This is also resolved for implementation:

- `ApprovalDialog.tsx` is in scope for the visual redesign
- `EventStream.tsx` is in scope for the visual redesign
- `ControlBar.tsx` is in scope alongside them because all three appear together in `SessionDetail.tsx`

Their interaction behavior remains unchanged. The redesign only updates layout, visual hierarchy, and dashboard presentation.

## Goals

1. Preserve the current functional simplicity.
2. Make the UI feel like an operator dashboard rather than a form page.
3. Improve hierarchy so the most important session state is obvious at a glance.
4. Increase information density without making the page feel crowded.
5. Keep the implementation aligned with the existing Preact + Vite stack and current component structure.

## Non-Goals

1. Do not turn the product into a chat UI.
2. Do not add routing, a state library, or a UI kit.
3. Do not redesign gateway/API semantics.
4. Do not add large feature scope beyond presentation and lightweight operator usability improvements.

## Design Direction

The visual direction is "calm control room":

- light, neutral surfaces with a small amount of atmosphere
- stronger layout framing and spacing rhythm
- compact operational chips and status markers
- sharper typography hierarchy
- more visible grouping of data and actions

The tone should remain simple, but not bland. The page should feel like a dashboard used to monitor and steer active work.

## Reference Learnings

Useful ideas from the provided reference:

- persistent left-side navigation creates a stronger product shell
- compact controls and chips make the UI feel operational
- top-level summary and grouped actions reduce visual drift
- lighter cards with clearer spacing feel more premium than large blank panels

Ideas we should not copy:

- chat-first center layout
- generic AI messenger composition
- decorative controls that do not map to Octopus workflows

## Information Hierarchy

The default reading order should be:

1. Product shell and connection state
2. High-level session metrics
3. Selected session summary
4. Work items and approvals
5. Artifacts and event activity
6. Detailed gateway/runtime status

This replaces the current flat "three equal columns of cards" feeling.

## Proposed Layout

### 1. App Shell

Introduce a more intentional shell with three zones:

- left rail: session browser
- main column: selected session dashboard
- toggleable right rail on desktop: gateway/system status inspector

The header should become a true dashboard bar, not a loose title row. It should include:

- Octopus identity
- a short subtitle or environment label
- connection badge
- grouped actions such as status toggle and logout

### 2. Left Rail

The session list should become a denser sidebar with:

- a compact title row
- a refresh action integrated into the rail header
- session cards with state dot, shortened session id, and supporting metadata
- stronger selected styling

The left rail should feel like a control navigator, not a stack of default buttons.

### 3. Top Summary Band

Add a dashboard summary row above the detailed content. Suggested cards:

- total sessions
- active or blocked sessions
- completed sessions
- selected session item/artifact counts

This gives the page an immediate dashboard feel without changing the core workflow.
The band should live in `App.tsx` and use derived data from the existing `sessions` array plus the current `selectedSession`. No new API endpoint, persisted state, or extra fetch cycle is required.

### 4. Main Session Panel

The selected session area should lead with a stronger summary card:

- session id
- goal id
- lifecycle state badge
- created / updated timestamps
- quick operational metadata

Below that, use structured sections for:

- work items
- artifacts
- approval state
- recent event stream

These sections should feel like dashboard modules rather than long plain text lists.

### 5. Status Inspector

The current raw JSON status panel is useful but visually weak. Replace it with:

- a compact inspector card for important fields
- clear labels for connection/runtime/gateway state
- a secondary raw JSON view, either collapsible or visually subordinate

This keeps the operator-grade detail without letting raw JSON dominate the UI.
The desktop pattern is fixed: `showStatus` controls a third-column right rail inside the main grid. On smaller screens, the inspector becomes an inline collapsible section. Slide-over is explicitly not part of this redesign.

## Component-Level Intent

### `App.tsx`

- create the new dashboard shell and summary band
- derive summary metrics from existing `sessions` and `selectedSession` state
- move page-level actions into a stronger header
- keep inspector visibility as a toggleable desktop right rail and a mobile inline collapsible section

### `SessionList.tsx`

- convert session rows into denser rail cards
- add truncated ids and clearer active/blocked/completed signals
- keep selection and refresh behavior unchanged

### `SessionDetail.tsx`

- elevate the summary card visually
- reformat work items and artifacts into more scannable dashboard sections
- improve empty-state handling so an unselected or unavailable session does not look broken

### `ControlBar.tsx`

- visually align session control actions with the dashboard treatment
- keep existing pause / resume / cancel behavior unchanged

### `ApprovalDialog.tsx`

- approval handling is explicitly in scope for the redesign
- restyle the approval card so it matches the dashboard module system while preserving its high-signal risk emphasis

### `EventStream.tsx`

- live event activity is explicitly in scope for the redesign
- restyle event rows and container density so the stream feels like an operational module rather than a plain log block

### `StatusPanel.tsx`

- split summary metrics from raw JSON
- present status as an inspector, not a dump

### `ConnectionStatus.tsx`

- make the connection indicator a compact status chip
- visually group utility actions

### `index.css`

- define the dashboard visual system
- introduce CSS variables for color, spacing, radii, shadows, and typography
- keep those variables in `:root` within `index.css` for this scope; do not create a separate variables stylesheet
- add responsive rules that keep the dashboard structure coherent on smaller screens

## Visual System

### Color

Use a restrained light palette:

- warm white and pale gray-blue surfaces
- dark slate text
- one warm accent for active controls and selected states
- semantic states for connected, blocked, completed, failed

Avoid default blue-on-white as the dominant visual identity.

### Typography

Improve hierarchy with:

- stronger page title
- smaller uppercase or muted section labels where useful
- clearer numeric emphasis in summary cards

Keep typography clean and practical, not decorative.

### Cards and Surfaces

- reduce the feeling of oversized blank rectangles
- use layered surfaces with subtle borders and softer shadows
- increase density inside cards so information feels alive

## Responsive Behavior

Desktop:

- left rail visible
- summary band spans main content
- inspector appears as the toggleable third-column right rail

Tablet and mobile:

- layout collapses to a single main column
- session rail becomes top section or stacked panel
- summary cards wrap cleanly
- inspector becomes an inline collapsible section, not an overlay

The page should still feel like a dashboard on smaller screens, not revert to an unstructured card pile.

## Testing and Quality

The current repo concern is real: `surfaces-web` is not included in the workspace Vitest projects today.

Implementation should add lightweight UI coverage:

- include `surfaces-web` in `vitest.config.ts`
- add render-focused tests for the dashboard shell and key component states
- prefer lightweight component tests over heavy end-to-end coverage

Likely additions during implementation:

- `@testing-library/preact`
- `jsdom`

Minimum behaviors to cover:

- unauthenticated login view renders
- authenticated dashboard shell renders
- session selection state renders correctly
- status inspector visibility behaves correctly
- summary cards handle empty and populated states

Concrete component targets:

- `App.tsx`: login state vs authenticated dashboard shell, summary band rendering, inspector toggle behavior
- `SessionList.tsx`: selected session styling and compact session metadata rendering
- `SessionDetail.tsx`: populated dashboard sections for summary, work items, artifacts, approval, and events
- `StatusPanel.tsx`: compact inspector fields plus raw JSON fallback view

Fixture note:

- `SessionDetail` tests will need realistic `WorkSession`, `ApprovalRequest`, and `WorkEvent[]` fixture data because the component renders `ControlBar`, `ApprovalDialog`, and `EventStream` together

## Runtime and Build Artifact Safety

Current ignore posture is already correct and should remain intact:

- `.octopus/`
- `dist/`
- `node_modules/`
- `.pnpm-store/`
- generated `.js` / `.d.ts` files under package `src/`

The redesign should avoid introducing any new generated assets into tracked source folders. No additional artifact policy changes are required for the design itself.

## Success Criteria

The redesign is successful if:

1. The page reads immediately as a dashboard.
2. A user can understand connection state and selected session state within a few seconds.
3. Sessions, work items, artifacts, and status all remain easy to scan.
4. The UI still feels simple and local-first, not enterprise-heavy or chat-first.
5. `surfaces-web` has basic automated test coverage in the workspace.

## Likely Implementation Touch Points

- `packages/surfaces-web/src/App.tsx`
- `packages/surfaces-web/src/components/SessionList.tsx`
- `packages/surfaces-web/src/components/SessionDetail.tsx`
- `packages/surfaces-web/src/components/StatusPanel.tsx`
- `packages/surfaces-web/src/components/ConnectionStatus.tsx`
- `packages/surfaces-web/src/styles/index.css`
- `packages/surfaces-web/package.json`
- `vitest.config.ts`

## Notes

This design intentionally improves presentation and hierarchy without changing the product model. Octopus remains a session-centered operator surface with live state, approvals, artifacts, and observability, not a chatbot shell.
