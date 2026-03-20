# 路线三：场景化 Work Packs — Design

**日期**：2026-03-20
**状态**：Review 修正后
**关联战略**：[docs/strategy/2026-03-20-next-phase-strategy.md](../strategy/2026-03-20-next-phase-strategy.md)

---

## 目标

降低使用门槛——用户不需要自己写 goal 描述，选一个 pack、填参数就能跑。

---

## 设计决策（Codex review 修正后）

### 决策一：WorkPack 解析为完整 WorkGoal（不是只替换 description）

> **Codex 修正**：原设计只模板化 description，verificationPreset/expectedArtifacts 是死数据。
> 修正：Pack 定义 constraintTemplates + successCriteriaTemplates，resolveGoal 输出完整 WorkGoal。

```ts
export interface PackParam {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface WorkPack {
  id: string;
  name: string;
  category: "dev" | "data" | "ops" | "report";
  description: string;
  goalTemplate: string;                    // {{param}} 模板
  constraintTemplates: string[];           // 同样支持 {{param}}
  successCriteriaTemplates: string[];      // 同样支持 {{param}}
  params: PackParam[];
}
```

不含 verificationPreset/expectedArtifacts——这些在 engine 层没有消费者，不做死数据。

### 决策二：内置 4 个 Pack，强 goal 描述

每个 pack 的 goalTemplate 包含详细的任务指令、约束和成功标准。

### 决策三：自定义 Pack JSON + Schema Validation

`loadCustomPacks(dir)` 加载 JSON 文件，validateWorkPack() 验证完整结构。

### 决策四：CLI pack 命令，安全 profile 跟随配置

`pack run` 使用用户配置的 profile（默认 safe-local），pack 不自动升级安全等级。

### 决策五：Web TaskComposer 只用内置 Pack（bundled）

> **Codex 修正**：browser 无法加载文件系统 pack，需要 gateway API。
> v1 只 bundle 内置 pack 到 client-side，自定义 pack web 支持推迟。

### 决策六：Artifact Renderer 保守路线

> **Codex 修正**：regex Markdown 不可靠且有 XSS 风险。
> v1 只做：JSON 格式化 + CSV 表格渲染，其余保持 `<pre>`。不做 Markdown。

---

## 架构变更

```
packages/work-packs/              ← 新包（只依赖 work-contracts）
  src/types.ts                    WorkPack, PackParam
  src/builtin/                    4 个内置 pack
  src/registry.ts                 loadBuiltinPacks, loadCustomPacks, resolveGoal, validateParams, validateWorkPack
  src/index.ts

packages/surfaces-cli/
  src/cli.ts                      pack list / info / run 命令

packages/surfaces-web/
  src/components/ArtifactPreviewModal.tsx   JSON/CSV renderer
  src/components/TaskComposer.tsx           内置 pack 选择器
```

---

## 不在范围

- substrate tools (http-fetch, sql-query, browser)
- Gateway pack-list API（自定义 pack web 支持）
- Markdown 渲染
- verificationPreset / expectedArtifacts（engine 层无消费者）
- 社区模板分享
