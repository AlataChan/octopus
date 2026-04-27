# Four-Project Federation Design Spec

> Date: 2026-04-27
> Status: Draft v3 (revised after Codex plan review #2)
> Author: Claude (designer) — based on user direction "option 2b" from 2026-04-27 brainstorming
> Scope discipline: All TypeScript changes land in this repo. Sibling Python/Node projects (`Octopus_mem`, `octopus-kb`, `Skills`) are **not modified**. They are reached through their existing public CLIs.

## Revision History

- **v1 (2026-04-27):** initial draft.
- **v2 (2026-04-27):** revised after Codex plan review #1. Five findings addressed:
  - **High** — `KbPort` API rewritten to mirror real `octopus-kb` subcommands (`lookup`, `retrieve-bundle`, `neighbors`, `impacted-pages`) instead of a fictional composite shape. Composite `enrichPlanningContext()` added as an explicit orchestrator on top.
  - **High** — Skills materialization shape clarified: skills do **not** become `WorkPack` entries (incompatible schema). A new dedicated `SkillRegistryEntry` model is introduced; `WorkPack` is unchanged.
  - **High** — Build hook reframed as **opt-in**. Default `pnpm build` and `pnpm release:verify` never require any sibling repo. Materialization runs only when explicitly invoked or when a `skills.config.json` opt-in marker is present *and* a `SKILLS_REPO` path resolves.
  - **Medium** — Observability scope expanded to include `packages/observability`. New `KbAdapterEventType` union added with typed payloads and tests.
  - **Medium** — KB vault configuration path defined: lives on `ExecuteGoalOptions.kb` and on `WorkSession`, sourced from CLI flag, work-pack metadata, or session field. Resolution order specified.
- **v3 (2026-04-27):** revised after Codex plan review #2. Five further findings addressed:
  - **High** — `KbPort` raw result types rewritten **verbatim from the actual JSON Schemas** at `octopus-kb/schemas/cli/{lookup,retrieve-bundle,neighbors,impacted-pages}.json`. v2 invented field names (`items`, `excerpt`, `score`, `tokens`, flat `neighbors`, `{path,reason}` impacted) that did not exist. v3 introduces a two-layer model: **raw types** mirror the JSON Schemas exactly; **normalized types** are defined only above the adapter, used by `enrichPlanningContext` for the orchestrator's convenience.
  - **High** — `WorkPack` was contradicted: v2 said "byte-identical" yet also added an optional `kbVaultPath` field on the work-pack metadata type. v3 **removes** any change to work-pack metadata. KB vault resolution drops the work-pack tier; remaining tiers (CLI flag → `ExecuteGoalOptions.kb.vaultPath` → `OCTOPUS_KB_VAULT` env → unset) cover the use case without touching `work-packs`.
  - **Medium** — `ExecuteGoalOptions` lives in `packages/work-core/src/engine.ts`, not in `@octopus/work-contracts`. v3 corrects the placement: `KbOptions` is added to `work-core`, alongside `ExecuteGoalOptions`. No move/refactor.
  - **Medium** — `octopus-kb` has no `--version` CLI flag (verified: no `version` argparse handler in `cli.py`). v3 makes version capture **optional**: `available()` returns `{ ok: true, version: string | "unknown" }`. The adapter probes via Python package metadata (`python -m pip show octopus-kb`) when available, falls back to `"unknown"`. Observability `octopusKbVersion` becomes `string | "unknown"` and is no longer a hard requirement.
  - **Medium** — Stale "work-packs" wording removed from executive summary, architecture diagram, and risk table. All references to skills materializing into work-packs are replaced with `@octopus/skills-registry`.
- **v3.1 (2026-04-27):** minor fixes after Codex plan review #3:
  - `KbRawLookupCanonical.source_of_truth` changed to optional (`source_of_truth?: string | null`) to match `lookup.json`, where only `path` and `title` are required.
  - `loadSkillRegistry()` behavior clarified for clean checkouts: if no materialized manifest exists, it returns an empty registry instead of failing.
  - Zod dependency made explicit and scoped to the two new packages that need cross-boundary schema validation.
  - Stale method-pair wording corrected to `lookup`/`impactedPages`.

## Executive Summary

Wire the three sibling projects — **Octopus_mem**, **octopus-kb**, and **Skills** — into Octopus as **adapter-port subsystems**, without merging code or sharing on-disk formats. Each sibling stays canonical in its own repo and continues to evolve independently. Octopus becomes the integration host.

This is "option 2b" from the 2026-04-27 brainstorming session: a deliberately selective integration that matches each sibling to where it actually fits Octopus's runtime cost model.

| Sibling | Integration shape | Why this shape |
|---|---|---|
| **Octopus_mem** (Python) | **No runtime adapter.** Continue the existing native TS `@octopus/memory` plan. | The 2026-04-19 memory design already analyzed and rejected the cross-language hot-path. Memory injection runs every planning turn — a Python sidecar there would be a permanent operational tax. |
| **octopus-kb** (Python) | **Runtime adapter** — new `@octopus/kb` package shells out to the `octopus-kb` JSON CLI. | KB lookups happen at planning time, not every turn. octopus-kb's CLI was *designed* to return schema-validated JSON for agent consumption. Cost matches use. |
| **Skills** (Node + Markdown) | **Build-time materializer** — new `@octopus/skills-registry` pulls skills into its own dedicated registry bundle at build/install time, not runtime. | Skills is a packaging system. The new registry is the runtime's single source of truth for skill identity; `work-packs` (a different concept — parameterized goal recipes) is left untouched. |

The deliverable is **two new TypeScript packages** plus a **top-level federation README** at the workspace level, plus thin documentation of how the four projects relate. No breaking changes to existing public APIs. No modification to any sibling project.

## Background

### What's in the Workspace Today

The `Cursor_projects/` directory contains four sibling projects that were built independently but share a lineage:

| Project | Language | Maturity | Role |
|---|---|---|---|
| `octopus` | TypeScript / pnpm monorepo (19 packages) | Active, actively shipping | The work-agent runtime — gateway, runtimes, surfaces-cli, surfaces-web |
| `Octopus_mem` | Python | Standalone, dual-repo (framework + private data) | Agent memory store with skill+memory index pattern |
| `octopus-kb` | Python (v0.6.0, 200 tests) | Mature, stable | Obsidian-style knowledge base; returns decisions (canonical pages, graph context, impact plans) as JSON |
| `Skills` | Node CLI + Markdown skills | Skill registry + lifecycle | Skill packaging, validation, install, evolution |

Today none of them reference each other in code. They are conceptually related but operationally siblings.

### What "Federation" Means Here

We use **federation** rather than **monorepo** or **rewrite** deliberately:

- Each sibling stays in its own repo with its own release cadence and language.
- Octopus owns the integration surface — typed ports, adapters, build-time pulls.
- The siblings don't know Octopus exists; Octopus calls them through their public CLIs.
- "One big project" is achieved at the **product** level (one entry point, one umbrella README, one cross-project CI), not at the **codebase** level.

### Why Not Port Octopus to Python

Examined and rejected in the 2026-04-27 brainstorming. Cost: 4–7 months of full rewrite during which Octopus stops shipping. Reward: marginal — it would save ~1 week of CLI adapter work for two of the four projects. The web UI (`surfaces-web`) and MCP adapter would have to stay in TS anyway, so the polyglot situation wouldn't actually go away. **Decision: stay TS, integrate through ports.**

### Why Not Full Merge (Option 3)

Examined in the same brainstorming. The apparent overlap between Octopus_mem and octopus-kb is shallow — different write patterns (auto-promote vs human-curated), different read patterns (token-budgeted injection vs decision queries), different schemas. Forcing them into one store gives a worse version of both. Skills isn't a storage system at all — it's package management; it doesn't merge with anything. **Decision: do not unify storage; respect the existing boundaries.**

### Relationship to the 2026-04-19 Memory Design

The 2026-04-19 memory integration design ([docs/plans/2026-04-19-octopus-memory-integration-design.md](2026-04-19-octopus-memory-integration-design.md)) already settled the Octopus_mem question: re-implement its *concepts* as a TypeScript-native `@octopus/memory` package; do not bridge to the Python project at runtime.

**This spec inherits that decision unchanged.** Memory is mentioned here only to make clear that it is *also* part of the federation — it just doesn't need new adapter work, because the 2026-04-19 plan already covers it.

## Goals

1. Give the Octopus runtime access to **knowledge-base reasoning** (canonical pages, graph context, impact analysis) by adapting `octopus-kb` as a callable subsystem.
2. Give the Octopus build pipeline access to the **Skills registry** by materializing skill content into a dedicated `@octopus/skills-registry` bundle at build time. (`work-packs` is a separate concept and is not involved.)
3. Document the four projects as a **federation** with a clear top-level entry point, so a new contributor understands how they relate without spelunking.
4. Make every cross-project boundary **observable** — every adapter call traces what it asked, what it got back, and how long it took.
5. Keep every sibling project **independently runnable and releasable** — no sibling becomes a hard build-time dependency.

## Non-Goals

1. **Modifying any sibling project.** Octopus_mem, octopus-kb, and Skills stay byte-identical to their current state.
2. **Sharing on-disk formats** between Octopus and any sibling. Each project owns its own files.
3. **Replacing the existing `@octopus/memory` plan.** That work continues as designed; this spec does not change it.
4. **Embedding Python into Node** (PyO3, Pyodide, etc.). Adapters use process boundaries, not in-process FFI.
5. **A monorepo.** No code is moved into octopus/. The four projects keep separate git histories and releases.
6. **Auto-discovery / auto-install of siblings.** A user must explicitly install the Python projects they want adapters to call. Octopus runs fine without them — the adapters degrade gracefully.

## Architecture

### High-Level Picture

```
+------------------------------------------------------------+
|                    Octopus runtime                         |
|                                                            |
|  work-core  ──►  @octopus/kb (port)                        |
|                       │                                    |
|                       ▼  (subprocess, JSON over stdout)    |
|                  octopus-kb CLI  (Python, separate repo)   |
|                                                            |
|  surfaces-cli ◄── @octopus/skills-registry (build-time)    |
|                       │                                    |
|                       ▼  (file copy + metadata transform)  |
|                  Skills repo  (Node + Markdown, separate)  |
|                                                            |
|  work-core  ──►  @octopus/memory (already designed)        |
|                       │                                    |
|                       ▼  (in-process TS, no sibling call)  |
|                  Native TS index + storage                 |
+------------------------------------------------------------+
                              ▲
                              │
                  No call into Octopus_mem at runtime.
                  (Octopus_mem evolves independently.)
```

### New Packages

#### `@octopus/kb`

A TypeScript port + adapter for the `octopus-kb` Python CLI.

**Real CLI surface we adapt** (verified against `octopus-kb` v0.6.0 `cli.py`):

| Subcommand | Args | JSON output |
| --- | --- | --- |
| `lookup <term> --vault <path> --json` | positional term, required vault | `{ canonical, aliases, ambiguous, collisions, next }` |
| `retrieve-bundle <query> --vault <path> --max-tokens <n> --json` | positional query | ordered evidence bundle |
| `neighbors <page> --vault <path> --json` | positional page path | graph neighbors for a page |
| `impacted-pages <page> --vault <path> --json` | positional page path | pages likely impacted by a change |

**Two-layer type model (Codex review #2 fix):**

The adapter exposes types in two layers:

- **Raw types (`KbRaw*`)** — mirror the on-wire JSON Schemas at `octopus-kb/schemas/cli/*.json` **verbatim**. Field names, optionality, nullability, and shapes are identical to the schema. The Zod schemas the adapter validates against are derived from these. Raw types are exported so callers that want full fidelity (or future surfaces like a CLI passthrough) can use them.
- **Normalized types (`KbNormalized*`)** — defined **above** the adapter for the convenience of `enrichPlanningContext`. They drop fields the orchestrator does not consume, flatten what is convenient to flatten, and never invent fields that aren't in the raw output. They are derived deterministically from raw types.

`KbPort` returns **raw** types. Normalization happens in `enrichPlanningContext`. This separation makes the adapter a faithful proxy and keeps schema-drift detection at the wire boundary.

**Raw types — verbatim from the JSON Schemas:**

```ts
// === lookup (verbatim from schemas/cli/lookup.json) ===

export interface KbRawLookupCanonical {
  path: string;
  title: string;
  source_of_truth?: string | null;  // optional in schema; when present allows ["string", "null"]
}

export interface KbRawLookupAlias {
  text: string;
  resolves_to: string;
}

export interface KbRawLookupResult {
  term: string;
  canonical: KbRawLookupCanonical | null;   // schema: oneOf [null, object]
  aliases: KbRawLookupAlias[];
  ambiguous: boolean;
  collisions: string[];
  next: string[];
}

// === retrieve-bundle (verbatim from schemas/cli/retrieve-bundle.json) ===

export type KbRawBundlePageReason =
  | "title_match"
  | "alias_match"
  | "related_entities"
  | "backlink"
  | "schema_anchor"
  | "index_anchor"
  | "log_anchor";

export interface KbRawBundlePage {
  path: string;
  title: string;
  reason: KbRawBundlePageReason;
}

export interface KbRawBundleWarning {
  code: string;
  message: string;
}

export interface KbRawBundle {
  schema: string[];
  index: string[];
  concepts: KbRawBundlePage[];
  entities: KbRawBundlePage[];
  raw_sources: KbRawBundlePage[];
}

export interface KbRawRetrieveBundleResult {
  query: string;
  bundle: KbRawBundle;
  warnings: KbRawBundleWarning[];
  token_estimate: number;          // integer, minimum 0; character heuristic, NOT a real tokenizer
  next: string[];
}

// === neighbors (verbatim from schemas/cli/neighbors.json) ===

export type KbRawNeighborVia = "wikilink" | "related_entities";

export interface KbRawInboundNeighbor {
  path: string;
  via: KbRawNeighborVia;
  count: number;                   // integer, minimum 1
}

export interface KbRawOutboundNeighbor {
  path: string;
  via: KbRawNeighborVia;
}

export interface KbRawNeighborsResult {
  page: string;
  inbound: KbRawInboundNeighbor[];
  outbound: KbRawOutboundNeighbor[];
  aliases: string[];
  canonical_identity: string | null;
  next: string[];
}

// === impacted-pages (verbatim from schemas/cli/impacted-pages.json) ===

export interface KbRawImpactedPagesResult {
  page: string;
  impacted: string[];              // schema: array of strings, NOT objects
  next: string[];
}
```

**Inputs (kept TypeScript-idiomatic; only the wire output is bound to schemas):**

```ts
export interface KbLookupInput {
  term: string;
  vaultPath: string;
}

export interface KbRetrieveBundleInput {
  query: string;
  vaultPath: string;
  maxTokens?: number;              // 0 = no limit (matches CLI default)
}

export interface KbNeighborsInput {
  pagePath: string;
  vaultPath: string;
}

export interface KbImpactedPagesInput {
  pagePath: string;
  vaultPath: string;
}
```

**Port — returns raw types:**

```ts
export interface KbPort {
  lookup(input: KbLookupInput): Promise<KbRawLookupResult>;
  retrieveBundle(input: KbRetrieveBundleInput): Promise<KbRawRetrieveBundleResult>;
  neighbors(input: KbNeighborsInput): Promise<KbRawNeighborsResult>;
  impactedPages(input: KbImpactedPagesInput): Promise<KbRawImpactedPagesResult>;
  available(): Promise<
    | { ok: true; version: string | "unknown" }
    | { ok: false; reason: string }
  >;
}
```

**Normalized types — defined above the adapter, used by `enrichPlanningContext`:**

```ts
// Convenience views derived from raw types. Never invent fields.

export interface KbNormalizedCanonical {
  path: string;
  title: string;
  sourceOfTruth: string | null;     // normalized from raw source_of_truth ?? null
}

export interface KbNormalizedEvidenceItem {
  path: string;
  title: string;
  reason: KbRawBundlePageReason;
  bucket: "concepts" | "entities" | "raw_sources";   // which bundle section it came from
}

export interface KbNormalizedEvidence {
  items: KbNormalizedEvidenceItem[];   // flattened from bundle.{concepts,entities,raw_sources}
  warnings: KbRawBundleWarning[];      // forwarded as-is
  tokenEstimate: number;               // forwarded as-is (still a character heuristic)
}

export interface KbNormalizedNeighbors {
  inbound: KbRawInboundNeighbor[];     // forwarded as-is
  outbound: KbRawOutboundNeighbor[];   // forwarded as-is
  canonicalIdentity: string | null;
}
```

**Composite orchestrator (separate function, not a port method):**

```ts
// enrichPlanningContext is the only entry point work-core calls.
// It explicitly orchestrates the primitive port calls in a fixed order
// and converts raw results into normalized views.
// This isolates work-core from the multi-step protocol, isolates work-core
// from the on-wire schema, and gives one place to short-circuit on the
// first useful signal under a token budget.

export interface PlanningEnrichmentInput {
  query: string;
  vaultPath: string;
  tokenBudget: number;
}

export interface PlanningEnrichmentResult {
  canonical: KbNormalizedCanonical | null;     // from lookup(query as term)
  aliases: KbRawLookupAlias[];                 // forwarded from raw lookup
  ambiguous: boolean;                          // forwarded from raw lookup
  evidence: KbNormalizedEvidence | null;       // from retrieve-bundle, if budget allows
  neighbors: KbNormalizedNeighbors | null;     // from neighbors(canonical.path), if canonical present
  steps: Array<{
    step: "lookup" | "retrieve-bundle" | "neighbors";
    ms: number;
    ok: boolean;
    skippedReason?: "budget_exhausted" | "no_canonical" | "kb_unavailable";
  }>;
}

export async function enrichPlanningContext(
  port: KbPort,
  input: PlanningEnrichmentInput
): Promise<PlanningEnrichmentResult>;
```

The composite is the **only** function `work-core` imports. The four primitive port methods exist to (a) be testable in isolation, (b) let future callers (e.g., a future `surfaces-cli kb` command) call them directly without going through planning enrichment, and (c) keep the raw schema visible at the wire boundary for drift detection.

**Adapter implementation:**

- Spawns `octopus-kb` via `node:child_process` with the `--json` flag on every supported subcommand. Vault and term/query passed exactly as the CLI expects (positional vs `--vault`).
- Parses returned JSON against per-command Zod schemas derived 1:1 from `octopus-kb/schemas/cli/*.json` v0.6.0. Schemas are pinned by content hash; the adapter records the schema hash it validated against on every call.
- Wraps stderr / non-zero exits as typed errors (`KbAdapterError` with `kind: "not_installed" | "vault_invalid" | "timeout" | "schema_drift" | "command_failed"`).
- Per-call timeout (default 10s, configurable).
- Emits typed observability events (see "Observability scope" below).

**Dependency note:**

This work introduces `zod` as a dependency of the two new packages only:

- `@octopus/kb` uses Zod for strict runtime validation of external JSON emitted by `octopus-kb`.
- `@octopus/skills-registry` uses Zod for `SkillRegistryEntry` and `skills.config.json` validation.

Existing packages, including `@octopus/memory`, do not gain a Zod dependency. The dependency is justified here because both new packages validate data crossing repo/process boundaries, where TypeScript-only guards would otherwise duplicate JSON Schema structure by hand.

**Version capture (Codex review #2 fix):**

`octopus-kb` v0.6.0 exposes no `--version` CLI flag (verified against `cli.py`). The adapter therefore probes version with a fallback chain:

1. `python3 -m pip show octopus-kb` (parse `Version:` line). Used inside `available()`. Cached for the lifetime of the adapter instance.
2. If pip is unavailable, `python3 -c "import importlib.metadata; print(importlib.metadata.version('octopus-kb'))"`.
3. If both fail, version is `"unknown"`.

`available()` returns `{ ok: true, version: string | "unknown" }`. Observability payloads carry `octopusKbVersion: string | "unknown"`. `"unknown"` is **not** an error condition — the adapter still operates, schema-drift detection still works (it depends on schema-hash, not version string).

If `octopus-kb` ever adds a `--version` flag in a future release, the adapter can prefer that path. No spec change needed.

**Degradation:**

- If `octopus-kb` is not installed, `available()` returns `{ ok: false, reason }` and `lookup`/`impactedPages` throw `KbAdapterError({ kind: "not_installed" })`.
- `work-core` callers must check `available()` before depending on the port. The work loop tolerates absence: KB enrichment becomes a no-op, planning continues without it.

**Schema drift defense:**

- octopus-kb is a separate project on its own release cadence. To prevent silent breakage when its JSON schema changes, the adapter validates every response against a pinned Zod schema and records the schema hash plus the optional observed `octopus-kb` version (`"unknown"` when unavailable) on every call.
- Schema mismatches surface as a typed error, not a runtime crash.

#### `@octopus/skills-registry`

A TypeScript build-time tool + runtime helper that pulls skills from the `Skills` repo into a **dedicated registry inside Octopus**, distinct from `work-packs`.

**Why a separate registry, not work-packs entries:**

The `WorkPack` interface in `packages/work-packs/src/types.ts` requires `category` (a closed enum), `goalTemplate`, `constraintTemplates`, `successCriteriaTemplates`, and `params` — a structured *task template* shape. Active skills in the `Skills` repo use frontmatter like `name / tier / domain / triggers / summary / depends / priority / platform / author / updated` plus a freeform Markdown body — a *guidance + activation hint* shape. There is no defensible deterministic transform from the second shape into the first; trying to fake one would invent goals/constraints/criteria that the skill author never wrote.

Skills and work-packs are **different concepts** that happen to both describe "things the agent can do":

- A **work-pack** is a parameterized goal recipe: "given these params, produce a goal + constraints + success criteria for the work loop."
- A **skill** is a piece of activatable judgment: "when these triggers match, load this guidance into the agent's context."

We model them separately. `work-packs` is left **completely unchanged** by this work.

**New model — `SkillRegistryEntry`** (defined in `@octopus/skills-registry`):

```ts
export interface SkillRegistryEntry {
  id: string;                      // unique within the registry; default = `<tier>/<domain>/<name>`
  name: string;                    // from frontmatter
  version: string;                 // from frontmatter
  tier: "core" | "lifecycle" | "factory" | "quality" | string;
  domain: string;                  // from frontmatter
  triggers: string[];              // activation hints
  summary: string;                 // one-line description
  depends: string[];               // other skill ids
  priority: "low" | "medium" | "high" | string;
  platforms: string[];             // platform field, normalized to array
  bodyPath: string;                // relative path inside the materialized bundle
  bodySha256: string;              // content hash for cache/audit
  sourceCommit?: string;           // Skills repo commit SHA at materialization time
  materializedAt: string;          // ISO timestamp
}
```

**Build-time tool (`skills-materialize`):**

A CLI invoked **explicitly** (or by an opt-in hook — see "Build hook is opt-in" below). It:

1. Reads a `skills.config.json` declaring which skills the Octopus distribution wants (by `<tier>/<domain>/<name>` + optional version pin).
2. Resolves the `Skills` repo source: `SKILLS_REPO` env var → `skills.config.json` `source` field → fallback default `../Skills` (a sibling clone). If none resolves to a real directory, the tool exits non-zero with an actionable message — but **only if it was actually invoked**. It is never invoked by `pnpm build` or `pnpm release:verify` by default.
3. For each declared skill: copies `skill.md` into `packages/skills-registry/dist/bundle/<id>/skill.md`, parses its frontmatter, validates against the `SkillRegistryEntry` schema, and emits one entry into the bundle index.
4. Writes a manifest (`skills-registry/dist/skills-materialized.json`) listing every materialized entry with content hashes and the source commit.
5. Idempotent and content-hashed: re-running with no source changes is a no-op.

**Runtime helper:**

`@octopus/skills-registry` exports:

- `loadSkillRegistry(): SkillRegistry` — reads the bundled manifest at runtime; no I/O against the Skills repo.
- `SkillRegistry` provides `list()`, `findById()`, `findByTrigger(query: string)`.

Used by `surfaces-cli` to display "available skills" and by future work-core integration points to look up skill body content. **No change to `work-packs` is required or made.**

**Clean-checkout behavior:**

`packages/skills-registry/dist/` is build output and is not committed. A fresh Octopus checkout therefore may not have a materialized skills manifest. `loadSkillRegistry()` must treat a missing manifest as an empty registry:

- `list()` returns `[]`.
- `findById()` returns `null`.
- `findByTrigger()` returns `[]`.

This keeps the default Octopus build and CLI behavior independent of the `Skills` repo. Once `skills-materialize` is explicitly run, the generated manifest is copied into `dist/` as part of the package build output and `loadSkillRegistry()` reads it normally.

**Why build-time, not runtime:**

- Skills change infrequently relative to Octopus deployments.
- Bundling skill bodies into the package's `dist/bundle/` makes the runtime self-contained — the Skills repo does not need to be present after materialization.
- A subprocess call per session-start would add noticeable latency for no benefit, since skill content rarely changes between sessions.

### Build Hook is Opt-In (Codex finding #3)

**Hard guarantee:** the default `pnpm build` and `pnpm release:verify` commands **never** require any sibling repo to be present. A fresh clone of `octopus` builds and tests cleanly with no `Skills`, `octopus-kb`, or `Octopus_mem` checkout anywhere on the machine.

`skills-materialize` is opt-in via three explicit triggers, in priority order:

1. **Direct CLI invocation:** `pnpm --filter @octopus/skills-registry materialize`. Always runs. Fails non-zero if the Skills repo cannot be resolved (this is the actionable failure mode — the user asked for it).
2. **Profile flag:** `pnpm build --profile=full` (a new optional profile). Runs `skills-materialize` as a pre-step. Without `--profile=full`, the standard build path is unchanged.
3. **Marker file:** if `skills.config.json` exists at the repo root **and** `SKILLS_REPO` env var resolves to an existing directory, a build hook script will run materialization. If only the marker exists but `SKILLS_REPO` is unset/missing, the hook **logs a one-line skip notice and exits 0** — it does not fail the build.

The default Octopus distribution ships **without** `skills.config.json` at the repo root. Users who want skill materialization opt in by creating the file and setting `SKILLS_REPO`. CI for `octopus` itself runs the standard build (no materialization). The federation CI workflow (Phase 3) is the place that exercises materialization end-to-end.

The same opt-in discipline applies to `@octopus/kb` calls at runtime: `available()` must return `{ ok: true }` before any caller invokes the port. If `octopus-kb` is not installed, the runtime continues unchanged and a one-time warning event is emitted.

### KB Vault Configuration Resolution (Codex review #2 corrections applied)

`KbLookupInput.vaultPath` (and the other KB inputs' `vaultPath`) must come from somewhere. The current `ExecuteGoalOptions` lives in **`packages/work-core/src/engine.ts:33`** (verified) — not in `@octopus/work-contracts`. We add `KbOptions` next to `ExecuteGoalOptions` in `work-core`. No move/refactor.

**`WorkSession` lives in `@octopus/work-contracts`** (verified — imported by `work-core` from work-contracts). The session-level frozen field is added there.

**`work-packs` is NOT modified.** v2 had proposed an optional `kbVaultPath` field on the work-pack metadata type, but `WorkPack` in `packages/work-packs/src/types.ts` has no metadata field at all and the spec also requires it to be byte-identical. v3 drops the work-pack tier from vault resolution entirely.

**Schema additions (additive, no breaking changes):**

```ts
// === @octopus/work-core (NEW interface, ADDITIVE field on ExecuteGoalOptions) ===
// File: packages/work-core/src/engine.ts

export interface KbOptions {
  vaultPath?: string;          // absolute path to an Obsidian-style vault
  enabled?: boolean;           // default false; must be true for any KB call to fire
}

export interface ExecuteGoalOptions {
  // ...existing fields unchanged...
  kb?: KbOptions;              // NEW, optional
}

// === @octopus/work-contracts (ADDITIVE field on WorkSession) ===

export interface WorkSession {
  // ...existing fields unchanged...
  kbVaultPath?: string;        // NEW, optional. Resolved at session-start, frozen for session lifetime.
}
```

**Resolution order at session start (first hit wins):**

1. `ExecuteGoalOptions.kb.vaultPath` (explicit caller override — CLI flag `--kb-vault <path>`, gateway request field, etc.).
2. Environment variable `OCTOPUS_KB_VAULT`.
3. Unset → `WorkSession.kbVaultPath = undefined`. KB calls are skipped for this session, regardless of `kb.enabled`.

The work-pack tier deliberately does **not** appear here. If a future workflow needs work-pack-level vault declarations, that is a separate spec that can introduce work-pack metadata without being entangled with this work.

**Enable gating:** even with a `kbVaultPath` resolved, KB calls only fire when `ExecuteGoalOptions.kb.enabled === true`. Default is `false` to preserve existing behavior.

### Observability Scope (Codex finding #4)

`packages/observability` exposes a strict `WorkEventType` union. New event names will not type-check unless `observability` is modified. We therefore **add `packages/observability` to the in-scope list** for this work, with the following additive changes:

```ts
// New union, added to types.d.ts:
export type KbAdapterEventType =
  | "kb.adapter.call.started"
  | "kb.adapter.call.completed"
  | "kb.adapter.call.failed"
  | "kb.adapter.unavailable";

// Composed into the master union:
export type WorkEventType =
  | SessionEventType
  | WorkItemEventType
  | CoreEventType
  | SubstrateEventType
  | SnapshotEventType
  | WorkspaceLockEventType
  | VerificationPluginEventType
  | ArtifactManagementEventType
  | PolicyEventType
  | AutomationEventType
  | GatewayEventType
  | RemoteSessionEventType
  | McpEventType
  | ChatEventType
  | KbAdapterEventType;   // ← additive
```

**Typed payloads (added alongside existing payload interfaces):**

```ts
export interface KbAdapterCallStartedPayload {
  command: "lookup" | "retrieve-bundle" | "neighbors" | "impacted-pages";
  vaultPathHash: string;       // sha256 of vault path; not the path itself
  queryHash?: string;          // sha256 of term/query; never the raw text
}
export interface KbAdapterCallCompletedPayload {
  command: KbAdapterCallStartedPayload["command"];
  durationMs: number;
  octopusKbVersion: string | "unknown";   // probed via pip; "unknown" when probe fails
  schemaHash: string;          // sha256 of the wire-output JSON schema the response validated against
  resultItemCount: number;
}
export interface KbAdapterCallFailedPayload {
  command: KbAdapterCallStartedPayload["command"];
  durationMs: number;
  errorKind: "not_installed" | "vault_invalid" | "timeout" | "schema_drift" | "command_failed";
  message: string;             // safe message; no query/term content
}
export interface KbAdapterUnavailablePayload {
  reason: string;
}
```

**Unit tests** in `@octopus/observability` cover serialization round-tripping for each new payload, mirroring the pattern used for existing payloads.

A second observability addition for `@octopus/skills-registry` is **not** needed in Phase 2 — materialization is a build-time activity and writes to its own manifest. If a runtime skill-load event is later required, it will be added in a follow-up.

### Top-Level Federation Layout

A new file at the workspace root (one level above `octopus/`):

```
Cursor_projects/
  README.md                    ← NEW: explains the federation
  octopus/                     (TypeScript runtime — host)
  Octopus_mem/                 (Python — agent memory framework, optional)
  octopus-kb/                  (Python — KB CLI, called by @octopus/kb when installed)
  Skills/                      (Node + Markdown — pulled by skills-materialize at build)
```

**The README explains:**

- One-paragraph identity for each project.
- Which projects are **required** (octopus only) vs **optional** (the other three).
- The integration map (which package adapts which sibling).
- How to install only the pieces you want.

### Data Flow Examples

**Planning turn that uses KB (when enabled and vault resolved):**

```
work-core → resolve kbVaultPath at session start (see "KB Vault Configuration Resolution")
work-core → enrichPlanningContext(kbPort, { query, vaultPath, tokenBudget })
              → port.lookup({ term: query, vaultPath })
                  → spawn `octopus-kb lookup <term> --vault <path> --json`
                  → parse stdout JSON, validate against pinned Zod schema
                  → return KbRawLookupResult: { term, canonical: {path,title,source_of_truth?}|null,
                                                aliases: [{text,resolves_to}], ambiguous, collisions, next }
              → if budget remains: port.retrieveBundle({ query, vaultPath, maxTokens: remainingBudget })
                  → spawn `octopus-kb retrieve-bundle <query> --vault <path> --max-tokens N --json`
                  → return KbRawRetrieveBundleResult: { query, bundle: { schema, index,
                                                        concepts, entities, raw_sources },
                                                        warnings, token_estimate, next }
              → if canonical present: port.neighbors({ pagePath: canonical.path, vaultPath })
                  → spawn `octopus-kb neighbors <page> --vault <path> --json`
                  → return KbRawNeighborsResult: { page, inbound, outbound, aliases,
                                                   canonical_identity, next }
              → normalize raw results into PlanningEnrichmentResult
work-core → fold normalized result into planning context (under token budget)
observability → kb.adapter.call.started / completed / failed per primitive call
                (each carries schemaHash + octopusKbVersion|"unknown")
```

**Build that pulls Skills (opt-in only — see "Build Hook is Opt-In"):**

```
pnpm --filter @octopus/skills-registry materialize    (or `pnpm build --profile=full`)
  → resolve Skills repo source: SKILLS_REPO env → skills.config.json source → ../Skills fallback
  → for each declared skill in skills.config.json:
       → copy <Skills repo>/skills/<tier>/<domain>/<name>/skill.md
            into packages/skills-registry/dist/bundle/<id>/skill.md
       → parse frontmatter
       → validate against SkillRegistryEntry schema
       → append entry to bundle index
  → write packages/skills-registry/dist/skills-materialized.json
  (work-packs is NOT touched.)
```

### Error Handling

| Failure | Detection | Response |
| --- | --- | --- |
| octopus-kb not installed | `available()` returns `{ ok: false }` | Caller skips KB step; work loop continues; one `kb.adapter.unavailable` event in trace per session. |
| octopus-kb returns non-JSON / invalid JSON | Zod parse fails in adapter | Throw `KbAdapterError({ kind: "schema_drift" })`; emit `kb.adapter.call.failed`; `enrichPlanningContext` records the step as failed and continues with the partial result it already has. |
| octopus-kb subcommand exits non-zero | Adapter checks exit code | Throw `KbAdapterError({ kind: "command_failed" })`; emit `kb.adapter.call.failed`. |
| `kbVaultPath` does not exist or is not readable | Resolver checks at session start | Throw `KbAdapterError({ kind: "vault_invalid" })` once; subsequent calls in the session are skipped. |
| octopus-kb timeout | Per-call timer | Kill subprocess; throw `KbAdapterError({ kind: "timeout" })`; emit `kb.adapter.call.failed`; caller skips. |
| `kb.enabled` is false or `kbVaultPath` unset | Resolver | KB is silently inactive — no port calls, no events, no error. |
| `skills-materialize` invoked but Skills repo cannot be resolved | Resolver fails | Exit non-zero with actionable message ("set SKILLS_REPO or clone Skills to ../Skills"). Default `pnpm build` does not invoke this command, so the standard build is unaffected. |
| Skill frontmatter does not match `SkillRegistryEntry` schema | `skills-materialize` validates each skill | Exit non-zero naming the offending skill file and which field failed. |
| `skills.config.json` references an unknown skill | `skills-materialize` resolves declarations | Exit non-zero naming the unknown skill ID. |
| Build hook sees `skills.config.json` marker but `SKILLS_REPO` is unset | Hook script | Log a one-line skip notice and exit 0 — never fails the build. |

### Testing

- **`@octopus/kb` adapter:** unit tests with a fake subprocess (mocking `child_process.spawn`); integration test gated behind `KB_INTEGRATION=1` env that runs against a real `octopus-kb` install if present.
- **`@octopus/skills-registry` materializer:** unit tests against a fixture Skills tree under `__fixtures__/`; verifies frontmatter validation, manifest generation, empty-registry behavior when the materialized manifest is absent, and clean failure modes.
- **No tests are added to sibling projects.** They keep their own test suites untouched.

## Implementation Phases

### Phase 0 — Top-Level Federation README (½ day)

Write `Cursor_projects/README.md` describing the four projects and their relationship. This is the cheapest, highest-leverage piece — it changes the *story* of the workspace without changing any code.

**Deliverable:** one Markdown file. Reviewable as a single PR.

### Phase 1 — `@octopus/kb` Adapter (4 days)

1. Scaffold `packages/kb/` mirroring `packages/memory/` layout.
2. Add `KbAdapterEventType` union + four payload interfaces to `packages/observability`. Wire into `WorkEventType`. Add round-trip tests.
3. Add optional `kbVaultPath` field on `WorkSession` in `@octopus/work-contracts`. Add `KbOptions` interface and optional `kb` field on `ExecuteGoalOptions` in **`packages/work-core/src/engine.ts`** (where `ExecuteGoalOptions` actually lives — verified). **`work-packs` is not modified.**
4. Define raw `KbRaw*` types verbatim from `octopus-kb/schemas/cli/{lookup,retrieve-bundle,neighbors,impacted-pages}.json`. Define normalized `KbNormalized*` types above the adapter. Define per-command Zod schemas derived 1:1 from those JSON Schemas; pin by content hash. Add `zod` as a dependency of `@octopus/kb`.
5. Define the four `KbPort` methods (returning raw types) + `enrichPlanningContext` orchestrator (returning normalized result).
6. Implement subprocess adapter with timeout, schema validation, schema-hash recording, and the new typed observability events.
7. Implement `available()` with the version-probe fallback chain (`pip show` → `importlib.metadata` → `"unknown"`). Cache result for the adapter instance lifetime.
8. Implement `kbVaultPath` resolver in `work-core` (CLI flag → `ExecuteGoalOptions.kb.vaultPath` → `OCTOPUS_KB_VAULT` env → unset). **No work-pack tier.**
9. Wire **one** integration touchpoint in `work-core` — the planning step — gated by `kb.enabled === true` (default `false`).
10. Write unit tests for each port method (mocked subprocess) using fixture JSON drawn from the real schemas + an integration test gated behind `KB_INTEGRATION=1` that runs against a real `octopus-kb` install.

**Deliverable:** new `@octopus/kb` package, additive deltas in `work-core` + `work-contracts` + `observability`, one feature-flagged work-core touchpoint, tests passing. Default build and tests unchanged. `work-packs` byte-identical.

### Phase 2 — `@octopus/skills-registry` Materializer (3 days)

1. Scaffold `packages/skills-registry/` with a `bin/` for `skills-materialize` and a runtime `loadSkillRegistry()` helper.
2. Define `SkillRegistryEntry` schema (Zod) and `skills.config.json` schema (declares wanted skills by `<tier>/<domain>/<name>` + optional source override). Add `zod` as a dependency of `@octopus/skills-registry`.
3. Implement source resolver: `SKILLS_REPO` env → `skills.config.json` `source` → `../Skills` fallback → fail with actionable message **only if invoked**.
4. Implement materializer: read config → copy `skill.md` files → parse + validate frontmatter against `SkillRegistryEntry` → emit bundle index → write `skills-materialized.json` manifest with content hashes and source commit.
5. Add an opt-in build hook script: triggered by `skills.config.json` marker, no-op (exit 0) if `SKILLS_REPO` does not resolve. Default `pnpm build` is unaffected.
6. Write unit tests against a fixture Skills tree under `__fixtures__/` covering: success path, missing skill, invalid frontmatter, idempotent re-run, empty-registry behavior when the manifest is absent, and opt-in skip when source missing.

**Deliverable:** new package, opt-in build hook, tests passing. **`work-packs` is not modified.**

### Phase 3 — Cross-Project CI (1 day)

A workflow at `.github/workflows/federation.yml` (or equivalent) that:

- Clones all four projects.
- Runs each project's native test command (`pnpm test`, `pytest`, `pytest`, `pnpm test`).
- Runs the `@octopus/kb` integration test against a real `octopus-kb` install.
- Runs `skills-materialize` against the real `Skills` repo and verifies the build still succeeds.

**Deliverable:** one CI workflow proving the federation holds together end-to-end.

### Total Effort Estimate

**~8.5 working days** of focused work (Phase 0: 0.5d, Phase 1: 4d, Phase 2: 3d, Phase 3: 1d). Each phase is independently shippable. Phase 1 grew from 3d to 4d after adding the observability/work-contracts deltas and the vault config resolver to its scope.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `octopus-kb` JSON schema drifts in a future release | Medium | Medium — adapter would silently break | Pin Zod schema by content hash; record schema hash plus optional version; treat schema mismatch as typed error, not crash; CI integration test catches drift early. |
| Build becomes slow because materializer runs on every build | Low | Low | Materializer is idempotent and content-hashed; skips if `skills-materialized.json` is up to date. |
| Two registries of "skills" appear (Skills repo + skills-registry bundle) and drift | Medium | Medium | The materializer is the *only* writer to the bundle under `packages/skills-registry/dist/bundle/`; the manifest declares "managed by skills-materialize, do not edit by hand". `work-packs` is a different concept entirely (parameterized goal recipes) and is not in the picture. |
| User installs Octopus without the Python siblings and is confused why KB features don't work | High | Low | `available()` capability check + clear CLI message ("install octopus-kb to enable KB features"). README documents the optional pieces. |
| Memory work and KB work confuse each other (both are "knowledge") | Medium | Low | Federation README + each package's README explain the difference: memory = what the agent learned; KB = what the user curated. |
| A sibling project's repo path changes and the materializer breaks builds | Low | Medium | `skills.config.json` accepts both local path and URL; CI uses pinned commit; failure mode is fast and actionable. |

## Open Questions

1. **Where does `Cursor_projects/README.md` actually live in version control?** It's above the octopus repo root. Options: (a) a new tiny git repo for the workspace, (b) commit it inside octopus as `docs/federation/README.md` with a symlink up. Recommend (b) for simplicity — Octopus already documents the federation as part of being the host.

2. **Should `@octopus/kb` cache results?** First version: no. The work loop already has caching at the planning layer. Adding cache here doubles invalidation logic. Revisit if profiling shows duplicate calls.

3. **Should `skills-materialize` support pulling from a published npm package** in addition to a local clone? First version: local clone only. Adding npm publishing for Skills is a separate workstream.

4. **How do we version the federation as a whole?** First version: don't. Each project versions independently; the federation README documents which versions of the siblings the current Octopus release expects to integrate with.

## Out of Scope (Explicit)

- Any modification to Octopus_mem, octopus-kb, or Skills source code.
- Any merge of the four git histories.
- Embedding Python into Node.
- Replacing the in-flight `@octopus/memory` work.
- Bridging Octopus_mem at runtime (already analyzed and rejected in 2026-04-19 design).
- Any change to `packages/work-packs/src/types.ts` (work-packs and skills are deliberately separate models).

## In Scope — Touchpoints in Existing Packages

Changes to existing packages are limited to the following additive touchpoints:

- **`packages/work-core/src/engine.ts`** — additive: new `KbOptions` interface and optional `kb` field on `ExecuteGoalOptions`. Plus one new feature-flagged call site in the planning step that invokes `enrichPlanningContext()` from `@octopus/kb`. Plus the `kbVaultPath` resolver (CLI flag → `ExecuteGoalOptions.kb.vaultPath` → `OCTOPUS_KB_VAULT` env → unset).
- **`packages/work-contracts`** — additive: optional `kbVaultPath` field on `WorkSession`. No other contract changes.
- **`packages/observability`** — additive: `KbAdapterEventType` union and four new payload interfaces, composed into `WorkEventType`.
- **Root `package.json` / `pnpm-workspace.yaml`** — register two new packages (`@octopus/kb`, `@octopus/skills-registry`).
- **Optional opt-in build hook** — a script that runs `skills-materialize` when `skills.config.json` + `SKILLS_REPO` are both present. Skips silently otherwise.

No other existing package is modified. **`packages/work-packs/src/types.ts` is byte-identical** to its pre-change state.

## Acceptance Criteria

This work is complete when:

1. ✅ `octopus/docs/federation/README.md` exists and explains the four projects + their integration map.
2. ✅ `@octopus/kb` package builds, type-checks, tests pass.
3. ✅ Raw `KbRaw*` result types are derived **verbatim** from `octopus-kb/schemas/cli/{lookup,retrieve-bundle,neighbors,impacted-pages}.json` — same field names, same nesting, same nullability, and same optional fields. Specifically: `KbRawLookupResult.canonical` is `{path,title,source_of_truth?}|null` (object, not string; `source_of_truth` is optional and may be null when present); `KbRawRetrieveBundleResult` carries `bundle: {schema,index,concepts,entities,raw_sources}` plus `warnings`, `token_estimate`, `next`; `KbRawNeighborsResult` has separate `inbound` and `outbound` arrays plus `aliases` and `canonical_identity`; `KbRawImpactedPagesResult.impacted` is `string[]`.
4. ✅ Per-command Zod schemas in the adapter validate real `octopus-kb` v0.6.0 JSON output without error in the integration test; schema hash is recorded on every call.
5. ✅ Normalized `KbNormalized*` types are defined above the adapter; `enrichPlanningContext()` is the only function `work-core` imports from `@octopus/kb` and returns the normalized `PlanningEnrichmentResult`.
6. ✅ `available()` returns `{ ok: true, version: string | "unknown" }` — version probed via `pip show octopus-kb` with `importlib.metadata` fallback; `"unknown"` is not treated as an error.
7. ✅ One work-core touchpoint exists, gated by `kb.enabled === true` (default `false`); it resolves `kbVaultPath` per the documented order (CLI flag → `ExecuteGoalOptions.kb.vaultPath` → `OCTOPUS_KB_VAULT` → unset, with **no work-pack tier**); it skips silently when the vault is unset or KB is unavailable.
8. ✅ `KbAdapterEventType` and four typed payloads are added to `@octopus/observability` and serialize round-trip in tests; the completed payload carries `octopusKbVersion: string | "unknown"` and `schemaHash: string`.
9. ✅ `KbOptions` and the optional `kb` field on `ExecuteGoalOptions` are added in **`packages/work-core/src/engine.ts`** (not in `work-contracts`, where `ExecuteGoalOptions` does not live).
10. ✅ Optional `kbVaultPath` field on `WorkSession` is added in `@octopus/work-contracts`; existing call sites compile unchanged.
11. ✅ `@octopus/skills-registry` package builds, type-checks, tests pass; `skills-materialize` produces valid `SkillRegistryEntry` bundle entries (a new model — **not** `WorkPack` entries) from a fixture Skills tree.
12. ✅ `loadSkillRegistry()` returns an empty registry when no materialized manifest exists, so a clean checkout without `Skills` present does not fail at runtime.
13. ✅ Default `pnpm build` and `pnpm release:verify` complete successfully on a clean machine **with no Skills repo, no octopus-kb install, and no Octopus_mem clone present**.
14. ✅ **`packages/work-packs/src/types.ts` is byte-identical** to its pre-change state. No optional `kbVaultPath` field, no metadata field, no other change.
15. ✅ Federation CI workflow exists and passes end-to-end against real installs of all four projects.
16. ✅ No file in `Octopus_mem/`, `octopus-kb/`, or `Skills/` has been modified.
17. ✅ Octopus's existing test suite (`pnpm release:verify`) still passes unchanged.

## Next Steps

1. **Plan review by Codex** (per project regulation §5). Send this spec via `/ask codex "[PLAN REVIEW REQUEST] ..."` with all four dimensions scored (correctness / simplicity / safety / convention). Pass criteria: overall ≥ 7.0, no dimension ≤ 3.
2. **User confirmation** of the integrated plan.
3. **Implementation spec** written to `2026-04-27-four-project-federation-implementation.md` after approval.
4. **Phase 0 first** — federation README is the cheapest, most informative deliverable and unblocks the rest.
