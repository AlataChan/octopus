# 路线三：场景化 Work Packs — Implementation Plan

**Goal:** 创建 Work Pack 系统，内置 4 个场景模板，CLI + Web 可一键执行

**Architecture:** 新包 `@octopus/work-packs` 提供 WorkPack 类型、内置 pack 定义、registry；CLI 新增 pack 命令；Web 增强 TaskComposer + ArtifactPreviewModal

---

## Task 1: 包脚手架 + 类型 + 内置 Packs

**Files:** Create `packages/work-packs/` (package.json, tsconfig, types, builtin packs, registry, index)

- [ ] 创建 package.json（依赖 @octopus/work-contracts）
- [ ] 创建 types.ts（WorkPack, PackParam）
- [ ] 创建 4 个内置 pack（repo-health-check, weekly-report, data-clean, dep-audit）
- [ ] 创建 registry.ts（loadBuiltinPacks, loadCustomPacks, resolveGoal, validateParams）
- [ ] 创建 index.ts
- [ ] 添加到 vitest.config.ts + tsconfig.base.json

**Tests:**
- registry.test.ts: loadBuiltinPacks returns 4 packs, resolveGoal replaces params, validateParams rejects missing required
- packs.test.ts: each builtin pack has valid structure

## Task 2: CLI pack 命令

**Files:** Modify `packages/surfaces-cli/src/cli.ts` + tests

- [ ] 添加 @octopus/work-packs 依赖
- [ ] 实现 `octopus pack list`
- [ ] 实现 `octopus pack info <pack-id>`
- [ ] 实现 `octopus pack run <pack-id> [--param k=v ...]`
- [ ] pack run 内部：parseParams → validateParams → resolveGoal → engine.executeGoal

**Tests:**
- pack list outputs pack names
- pack run calls engine with resolved goal

## Task 3: Rich Artifact Renderer

**Files:** Modify `packages/surfaces-web/src/components/ArtifactPreviewModal.tsx` + tests

- [ ] 按扩展名路由渲染（.md → simple markdown, .csv → table, .json → formatted, 其他 → pre）
- [ ] 简单 Markdown：# → h1-h3, **bold**, - list items, ``` code blocks
- [ ] CSV → HTML table（split by comma + newline）
- [ ] JSON → JSON.stringify(parse, null, 2) with syntax class

**Tests:**
- renders markdown headings
- renders CSV as table
- renders JSON formatted
- falls back to pre for unknown types

## Task 4: Web TaskComposer Pack Selector

**Files:** Modify `packages/surfaces-web/src/components/TaskComposer.tsx`, `App.tsx`

- [ ] TaskComposer 增加 pack 下拉选择
- [ ] 选择 pack 后自动填充 description（goalTemplate with blank params）+ namedGoalId
- [ ] 参数输入框（根据 pack.params 动态生成）
- [ ] 提交时用 resolveGoal 替换参数

**Tests:**
- selecting a pack fills the description
- pack params render input fields

## Task 5: 全局验证

- [ ] pnpm test（全量通过）
- [ ] pnpm --filter @octopus/work-packs run type-check

---

## 验证命令

```bash
pnpm --filter @octopus/work-packs test
pnpm --filter @octopus/surfaces-cli test
pnpm --filter @octopus/surfaces-web test
pnpm test
```
