# Surfaces Web I18n Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight i18n layer to `surfaces-web`, make Chinese the default UI language, and reserve a Chinese/English language switch in the frontend.

**Architecture:** Keep localization local to the web surface with a tiny dictionary-based provider and hook. Default to `zh-CN`, persist the selected locale in `localStorage`, and pass locale-aware translation/formatting through the existing component tree without adding a third-party framework.

**Tech Stack:** Preact, TypeScript, Vitest, Testing Library, localStorage

---

### Task 1: Add i18n test coverage

**Files:**
- Modify: `packages/surfaces-web/src/__tests__/smoke.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/app.test.tsx`
- Modify: `packages/surfaces-web/src/__tests__/session-detail.test.tsx`

**Step 1: Write failing tests**
- Assert the login surface renders Chinese copy by default.
- Assert the dashboard summary and inspector labels render Chinese by default.
- Assert the header exposes a language toggle and switching to English updates visible labels.

**Step 2: Run tests to verify failure**

Run: `pnpm --filter @octopus/surfaces-web test`

Expected: existing English assertions fail because the UI does not yet support localized strings or a locale toggle.

### Task 2: Add the lightweight i18n layer

**Files:**
- Create: `packages/surfaces-web/src/i18n/messages.ts`
- Create: `packages/surfaces-web/src/i18n/I18nProvider.tsx`
- Create: `packages/surfaces-web/src/i18n/useI18n.ts`
- Modify: `packages/surfaces-web/src/main.tsx`

**Step 1: Add dictionary and locale helpers**
- Define `zh-CN` and `en-US` message dictionaries.
- Add translation lookup, locale persistence key, and locale-aware date/time format helpers.

**Step 2: Add provider and hook**
- Provide current locale, setter, message lookup, and format helpers via context.
- Default to `zh-CN` when there is no stored selection.

### Task 3: Localize the UI and keep switching lightweight

**Files:**
- Modify: `packages/surfaces-web/src/App.tsx`
- Modify: `packages/surfaces-web/src/components/ApprovalDialog.tsx`
- Modify: `packages/surfaces-web/src/components/ConnectionStatus.tsx`
- Modify: `packages/surfaces-web/src/components/ControlBar.tsx`
- Modify: `packages/surfaces-web/src/components/EventStream.tsx`
- Modify: `packages/surfaces-web/src/components/LoginForm.tsx`
- Modify: `packages/surfaces-web/src/components/SessionDetail.tsx`
- Modify: `packages/surfaces-web/src/components/SessionList.tsx`
- Modify: `packages/surfaces-web/src/components/StatusPanel.tsx`

**Step 1: Replace inline strings with i18n keys**
- Convert user-visible copy to `t(...)`.
- Translate session state and risk level display values through mapping helpers.

**Step 2: Add locale switcher**
- Place a simple Chinese/English toggle in the header control area.
- Persist the user selection to `localStorage`.

**Step 3: Use locale-aware formatting**
- Replace raw `toLocaleString()` and `toLocaleTimeString()` calls with provider formatting helpers.

### Task 4: Verify end to end

**Files:**
- Modify if needed after verification

**Step 1: Run targeted checks**

Run:
- `pnpm --filter @octopus/surfaces-web test`
- `pnpm --filter @octopus/surfaces-web type-check`
- `pnpm --filter @octopus/surfaces-web build`

**Step 2: Run workspace tests**

Run:
- `pnpm test`

**Step 3: Review**
- Inspect `git diff --stat` and `git diff --check`.
- Confirm the UI defaults to Chinese and the English toggle remains available.
