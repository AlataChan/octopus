# Octopus Federation

Octopus is the TypeScript runtime host for a four-project federation. The sibling projects remain independently runnable and releasable; Octopus integrates with them only through explicit adapter or build-time boundaries.

## Projects

| Project | Required | Role | Integration |
| --- | --- | --- | --- |
| `octopus` | Yes | TypeScript work-agent runtime, gateway, runtimes, and surfaces | Host repository |
| `Octopus_mem` | No | Python agent-memory framework | No runtime bridge; Octopus continues the native TypeScript memory package plan |
| `octopus-kb` | No | Python Obsidian-style knowledge-base CLI | Called by `@octopus/kb` through JSON subprocess commands when enabled |
| `Skills` | No | Node and Markdown skill packaging system | Materialized by `@octopus/skills-registry` into an Octopus-local registry bundle when explicitly invoked |

## Boundaries

- Sibling repositories are not modified by Octopus federation work.
- Octopus owns the TypeScript contracts, adapters, observability events, and runtime gating.
- Optional integrations degrade cleanly. A fresh `octopus` checkout builds without `Octopus_mem`, `octopus-kb`, or `Skills` present.
- `work-packs` and skills remain separate concepts. Work-packs are parameterized goal recipes; skills are activation guidance and context.

## New Packages

`@octopus/kb` adapts the `octopus-kb` CLI commands `lookup`, `retrieve-bundle`, `neighbors`, and `impacted-pages`. It validates JSON output against pinned schemas, emits typed observability events, and exposes `enrichPlanningContext()` for work-core.

`@octopus/skills-registry` provides a runtime registry helper plus the future materializer surface for pulling selected skill Markdown from a local `Skills` checkout. If no materialized manifest exists, `loadSkillRegistry()` returns an empty registry.

## Enabling Optional Integrations

KB enrichment is inactive by default. Enable it per goal/session with `kb.enabled === true` and provide a vault path through `ExecuteGoalOptions.kb.vaultPath` or `OCTOPUS_KB_VAULT`.

Skill materialization is opt-in. The default build does not require the `Skills` repository; materialization should be run explicitly by the `@octopus/skills-registry` package once a source checkout and config are present.
