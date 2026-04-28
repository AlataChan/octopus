# Octopus Memory Integration Design Spec

> Date: 2026-04-19
> Status: Draft (revised after Codex review #1)
> Origin: Brainstorming session 2026-04-19 between Claude (designer) and Codex (reviewer); driven by giving Octopus a long-term memory layer inspired by the sibling Octopus_mem project
> Scope discipline: All implementation changes land in this repo. Octopus_mem is treated as a separate, untouched project — its format and code are an inspiration source, not a coupled dependency.

## Executive Summary

Add a new TypeScript package `@octopus/memory` to Octopus that gives the work loop **cross-session, scope-aware long-term memory** with retrieval-and-injection at planning time and human-gated promotion of valuable knowledge.

The package is designed around four principles, each chosen to avoid pitfalls identified in the brainstorming session and Codex's review:

1. **Don't duplicate what Octopus already has.** `state-store` already persists sessions/traces/snapshots, and the workspace already holds artifacts. `@octopus/memory` does **not** create a parallel store for session/workspace data — it indexes those as data sources and only persists *new* knowledge at the `skill`, `agent`, and `team` scopes.
2. **Schema is forward-looking; runtime is conservative.** The data model supports a 5-scope lattice (`session / agent / skill / workspace / team`) from day one to avoid future migration cost. The runtime activates only `skill` in Phase 1, with other scopes reserved as schema fields and scope qualifiers.
3. **Absorb, don't bridge, don't entangle.** `@octopus/memory` is implemented in TypeScript inside this repo. The Octopus_mem Python project is **not** modified, **not** depended on at runtime, and **not** required to share an on-disk format. Its data model and storage discipline are reused conceptually; the actual files Octopus writes are Octopus's own.
4. **Skill routing is explicit opt-in.** Memory injection only happens when a session declares its skill via CLI flag or work-pack metadata. There is no default skill — sessions without an explicit skill simply get no injection. This avoids cross-domain pollution from a wrong default.

The deliverable is one new TS package, four new exports on the `MemoryPort` interface, additive changes to `WorkSession` / `ContextPayload` / observability event types, and three integration touchpoints in `work-core`. No breaking changes to existing public APIs.

## Background

### What Octopus Already Persists

Before designing a memory layer, we audit what Octopus already remembers:

| Capability | Where it lives today | Status |
|---|---|---|
| Within-session turn state | `packages/work-core/src/turn-context.ts` | ✅ Done |
| Session persistence + snapshots | `packages/state-store/src/{store,snapshot,session-serde}.ts` | ✅ Done |
| Per-session JSONL trace | `packages/observability` (`TraceWriter` / `TraceReader`) | ✅ Done |
| Workspace files / artifacts | `workspace/` (per-session subtree) + workspace lock | ✅ Done |
| Cross-session reusable knowledge | — | ❌ Missing |
| Skill-scoped knowledge index | — | ❌ Missing |
| Knowledge injection into planning context | — | ❌ Missing |

Octopus today can **resume an interrupted task** but cannot **carry knowledge from one finished task into the next**. That gap is what `@octopus/memory` fills.

### What Octopus_mem Inspired

The sibling Octopus_mem Python project provided the conceptual seed for this work. From it we **adopt as principles**:

- Storage discipline: append-only Markdown for prose memories, JSON for indexes, no databases until forced.
- A skill-scoped index pattern: per-skill index files plus a long-term Markdown digest.
- A retrieval-and-injection pattern that selects candidates under a token budget.
- Six skill identities aligned with the OPC team agents: `dev / ops / content / law / finance / molt`.

We **do not** adopt:

- The Python implementation itself.
- The exact on-disk file format. Octopus writes its own format under its own filenames; the two systems do not share files at runtime.
- The `daily/` log layer. Octopus's traces already serve that role; re-implementing it would double-store.

### Why Not a Python Sidecar

Memory retrieval sits on the hot path of the work loop — every session start, possibly every planning turn. Putting a cross-language process boundary there permanently increases:

- Deployment complexity (Octopus targets single-tenant local-first; Python runtime + process management contradicts this).
- Failure modes (RPC timeouts, version skew, serialization).
- Observability (two trace systems must be reconciled).

The conceptual core (per-skill index, keyword retrieval, budget injection) is small enough to express directly in TypeScript. We pay the implementation cost once and avoid a permanent operational tax.

### Why Not Reuse Octopus_mem Files Directly

An earlier draft proposed making Octopus's memory files byte-compatible with Octopus_mem's. Codex's review correctly identified that Octopus_mem's current schema uses `additionalProperties: false` and a different file structure (`{version, skill_name, memory_entries, statistics}` rather than a record array), so true compatibility would require modifying Octopus_mem.

The user-imposed constraint for this work is: **all changes land in this repo; do not modify Octopus_mem.** Therefore Octopus owns its own format end-to-end. Octopus_mem can continue to evolve independently. If a user wants to view Octopus's memory data through Octopus_mem's Python CLI in the future, that adapter is out of scope here.

A consequence of this constraint: Phase 1 **does not import or read Octopus_mem's existing data**. Octopus's memory store starts empty and grows only through Octopus's own promote workflow. If a user wants to seed it from prior Octopus_mem records, they do so by re-promoting via the CLI — an explicit human action, not implicit sync.

## Goals

1. Give the work loop access to relevant prior knowledge at planning time, scoped to the current task's skill domain.
2. Provide a typed `MemoryPort` interface so memory backends are swappable.
3. Make memory injection **observable and reversible** — every injected memory is visible in the trace, surfaced to the user via CLI, and can be disabled with a single flag.
4. Make memory effectiveness **measurable**, not anecdotal — every injection records an outcome that can be reviewed.
5. Make memory writes **source-anchored** — every promoted record points at a verifiable source (trace event, artifact path, or explicit freeform marker).

## Non-Goals (Phase 1)

| Excluded | Why |
|---|---|
| Vector embeddings / semantic search | Adds dependency weight before keyword retrieval is proven insufficient |
| Automatic extraction from traces | High risk of feedback-loop pollution; defer to Phase 2 with explicit candidates |
| Private memory data repo sync (git submodule / token auth) | Premature; local files are sufficient to validate |
| Python sidecar / RPC integration | Permanent operational cost; absorbed into TS instead |
| Modifications to Octopus_mem | Out of scope by user constraint; Octopus_mem stays untouched |
| Reading or migrating Octopus_mem's existing files | Would re-introduce a coupling we explicitly rejected |
| Re-storing session or workspace data as "memory" | Already persisted by `state-store` and the workspace; would duplicate |
| MCP server for memory access | Defer until in-process API is proven |
| Multi-tenant access control | Single-tenant only |
| Automatic promotion to `agent / team / skill` scopes | Phase 1 is human-gated via CLI |
| Web dashboard panel for injected memories | Moved to Phase 2 to keep Phase 1 surface area minimal |
| Default skill fallback (e.g., `?? 'molt'`) | Risks cross-domain pollution; sessions without an explicit skill get no injection |

## The Scope Lattice (Data Model)

A memory record carries a `scope` (its primary owning level) plus optional `owner` qualifiers (additional restrictions). This is **not a strict tree** — a record can be `scope=skill, skill=dev, owner.workspaceId=octopus` meaning "a dev-skill memory that only applies in the octopus workspace."

### Five Scopes

| Scope | Meaning | Storage in Phase 1 | Notes |
|---|---|---|---|
| `session` | Bounded by one task | Not stored as memory | Trace + snapshot already cover this; used only as a *source* for promotion candidates |
| `agent` | Specific agent identity (e.g., a named OPC agent) | Schema reserved, not active | Activated when Octopus has a real multi-agent surface |
| `skill` | A capability domain (`dev`, `ops`, `content`, `law`, `finance`, `molt`) | **Active** | The only active storage scope in Phase 1 |
| `workspace` | A project / repo / customer space | Not stored as memory | The workspace tree itself + artifacts already cover this; used only as a scope **qualifier** on `skill` records and as a source for promotion |
| `team` | Cross-project organizational knowledge | Schema reserved, not active | Read-only target in later phases; never auto-written |

### Why `session` and `workspace` Are Not Storage Scopes

They are already stored — by `state-store` and the workspace tree respectively. A "session memory" or "workspace memory" record would either duplicate that data or fragment it. Instead:

- `session` and `workspace` participate as **scope qualifiers** on `skill` records (e.g., "this dev tip is only relevant to workspace X").
- `session` and `workspace` participate as **promotion sources** — extraction reads from a session's trace events or a workspace's artifacts to create a new `skill`-scoped record.

### Memory Record Schema

```ts
// packages/memory/src/schemas/memory-record.ts
export interface MemoryRecord {
  id: string;                     // content-addressed hash
  createdAt: string;              // ISO timestamp
  updatedAt: string;
  scope: 'session' | 'agent' | 'skill' | 'workspace' | 'team';
  owner: {
    agentId?: string;
    skillId?: SkillId;            // 'dev' | 'ops' | 'content' | 'law' | 'finance' | 'molt'
    workspaceId?: string;
    teamId?: string;
  };
  visibility: 'private' | 'agent' | 'skill' | 'workspace' | 'team';
  content: string;                // Markdown body
  kind: 'decision' | 'fact' | 'pattern' | 'open_question' | 'summary' | 'note';
  tags: string[];
  source:                         // mandatory; freeform must be explicit
    | { kind: 'trace-event'; sessionId: string; eventId: string }
    | { kind: 'artifact'; sessionId: string; path: string; lines?: [number, number] }
    | { kind: 'freeform'; reason: string };
  promotion: {
    status: 'candidate' | 'active' | 'rejected';
    confirmedBy?: 'user' | 'agent' | 'rule';
    confirmedAt?: string;
  };
  injectionStats: {
    timesInjected: number;
    lastInjectedAt?: string;
    positiveOutcomes: number;
    negativeOutcomes: number;
  };
}
```

In Phase 1 only records with `scope: 'skill'` and `promotion.status: 'active'` are stored and retrieved. Other scopes parse correctly but are not produced.

### On-Disk Layout

Octopus owns its own files. Filenames carry an `.octopus.` infix to make it unambiguous that they are not Octopus_mem files:

```text
~/.octopus/memory/
  long_term/
    MEMORY.octopus.md         # human-readable digest, append-only
  skill_indexes/
    dev.octopus.json          # { version: "octopus.v1", skill, entries: MemoryRecord[], statistics }
    ops.octopus.json
    content.octopus.json
    law.octopus.json
    finance.octopus.json
    molt.octopus.json
  storage/
    operations.octopus.jsonl  # append-only operations log
```

**Memory store location: per-user (`~/.octopus/memory/`), not per-workspace.** Skill memory is meant to be reused across projects ("the way I fix React bugs" should not be lost when switching workspaces). Workspace restriction is expressed via the `owner.workspaceId` field on individual records, not via filesystem path. This decision was finalized after considering per-workspace and hybrid alternatives; per-user with field-level qualification gives the most flexibility without losing isolation.

A future `--memory-root` override is reserved but not implemented in Phase 1.

### Format Versioning

The format version string is `octopus.v1`. Future format changes bump this; the loader rejects unknown versions with a clear error pointing at a migration command (which itself is out of Phase 1 scope, since v1 is the first version).

## The MemoryPort Interface

The work-core layer talks to memory through one stable interface. Implementations may be in-process (the default) or remote (future).

```ts
// packages/memory/src/port.ts
export interface MemoryPort {
  /**
   * Find candidate memories relevant to a query, scoped by skill and optional qualifiers.
   * Phase 1: keyword matching over skill index files.
   * Returns [] when no skillId is supplied (no default fallback).
   */
  retrieve(input: RetrieveInput): Promise<MemoryCandidate[]>;

  /**
   * Select which candidates to inject under a token budget. Returns a plan with explicit
   * inclusions and rejections (for trace logging and surface visibility).
   */
  planInjection(
    candidates: MemoryCandidate[],
    budget: InjectionBudget,
  ): Promise<MemoryInjectionPlan>;

  /**
   * Promote knowledge from a verifiable source into a stored memory record.
   * The source field is required and typed; the implementation validates that
   * trace events and artifact paths actually exist before writing.
   */
  promoteFromSource(input: PromoteInput): Promise<MemoryId>;

  /**
   * Record the outcome of an injection plan (was the task successful, how many
   * artifacts produced). Required input for any future automatic promotion or
   * scoring; in Phase 1 it feeds dashboards and ops-log only.
   */
  recordInjectionOutcome(
    planId: string,
    outcome: InjectionOutcome,
  ): Promise<void>;
}

export type PromoteInput = {
  skill: SkillId;
  kind: MemoryRecord['kind'];
  content: string;
  tags?: string[];
  workspaceId?: string;
  source:
    | { kind: 'trace-event'; sessionId: string; eventId: string }
    | { kind: 'artifact'; sessionId: string; path: string; lines?: [number, number] }
    | { kind: 'freeform'; reason: string };
};
```

### Why `promoteFromSource` Replaces "store"

A naive `storeObservation(content)` API encourages the agent or user to write whatever they think is interesting — exactly the feedback-loop risk Codex's review flagged. By making `source` a required, typed field with three explicit variants, every memory either anchors to a verifiable artifact/event or carries an explicit freeform marker that can be filtered or down-ranked by retrieval.

### Why `recordInjectionOutcome` Is in the Interface

If injection has no outcome channel, "is memory helping?" remains a feeling. Codex's earlier review explicitly named this risk. The interface forces every backend to accept outcomes; Phase 1 records them to JSONL even without acting on them, so we have data when promotion automation arrives.

## Public API Additions

This work makes additive changes to four packages. None are breaking.

### `packages/work-contracts`

Add to `WorkSession`:

```ts
interface WorkSession {
  // ... existing fields ...
  skillContext?: SkillId;        // when set, enables memory retrieval for this session
  injectionPlanIds?: string[];   // accumulated plan IDs for outcome recording at completion
}
```

Add a new exported type `SkillId = 'dev' | 'ops' | 'content' | 'law' | 'finance' | 'molt'`.

### `packages/agent-runtime`

Add to `ContextPayload`:

```ts
interface ContextPayload {
  // ... existing fields ...
  memoryBlock?: {
    planId: string;
    items: Array<{ id: string; content: string; kind: string }>;
  };
}
```

Runtime adapters render `memoryBlock` into a clearly-fenced section of the system prompt (e.g., `### Relevant Prior Knowledge ###`).

### `packages/observability`

Extend the event union with four new variants:

- `memory.retrieved` — query, candidate IDs, scores
- `memory.injected` — plan ID, included IDs, excluded IDs with reasons, token cost
- `memory.promoted` — record ID, source, skill, kind, confirmedBy
- `memory.outcome` — plan ID, session outcome, artifacts produced

### `packages/surfaces-cli`

New subcommands under `octopus memory`:

- `octopus memory promote --skill <id> --kind <k> ( --from-trace-event <eid> --session <sid> | --from-artifact <path> --session <sid> [--lines L1-L2] | --content <text> --no-source --reason <r> )`
- `octopus memory list [--skill <id>]`
- `octopus memory show <id>`
- `octopus memory reject <id>`

The CLI calls `TraceReader` (in `observability`) to validate trace-event sources, and the filesystem to validate artifact sources. `state-store` is **not** used for trace lookup.

### Deferred to Phase 2

- `packages/gateway` serialization of memory events for the web dashboard.
- `packages/surfaces-web` injected-memories panel.

## Package Structure

```text
packages/memory/
  package.json
  tsconfig.json
  src/
    index.ts                  # public exports: MemoryPort, types, default factory
    port.ts                   # the MemoryPort interface
    schemas/
      memory-record.ts        # MemoryRecord type + hand-written type guards (no zod)
      skill.ts                # SkillId enum + registry
    store/
      filesystem-store.ts     # reads/writes ~/.octopus/memory/ files
      log.ts                  # append-only ops log writer
    retrieval/
      keyword-retriever.ts    # tokenize + score, no embeddings in Phase 1
      scope-filter.ts         # apply scope+owner+visibility filters
    injection/
      planner.ts              # budget-aware selection, returns inclusions + rejections
      formatter.ts            # render injected memories as a prompt block
    promotion/
      promote-from-source.ts  # validates source, builds MemoryRecord, writes
    outcomes/
      outcome-recorder.ts     # appends to operations.octopus.jsonl
  __tests__/
```

Dependencies: `@octopus/work-contracts` (for shared types including the new `SkillId`), `@octopus/observability` (for trace events and `TraceReader`). **No new third-party dependencies.** Validation uses hand-written TypeScript type guards; this matches the project's existing convention and keeps the package dependency-free.

## Integration Points in Octopus

Three touchpoints, each minimal.

### 1. Engine Hook: Inject at Planning Time (`packages/work-core/src/engine.ts`)

Before the planner builds the prompt for a turn, call `MemoryPort.retrieve` then `planInjection`, then attach the formatted block to the turn context. **Skill is required** — no default.

```ts
// pseudo-code, not final
if (session.skillContext && process.env.OCTOPUS_MEMORY !== 'off') {
  const candidates = await memory.retrieve({
    query: goal.text,
    skill: session.skillContext,
    workspaceId: session.workspaceId,
    limit: 8,
  });
  const plan = await memory.planInjection(candidates, { tokenBudget: 800, maxItems: 2 });
  contextPayload.memoryBlock = formatInjection(plan);
  session.injectionPlanIds = [...(session.injectionPlanIds ?? []), plan.id];
  trace.emit('memory.retrieved', { query: goal.text, candidates: candidates.map(c => c.id) });
  trace.emit('memory.injected', { planId: plan.id, included: plan.included.map(i => i.id), excluded: plan.excluded });
}
```

Phase 1 defaults: `maxItems: 2`, `tokenBudget: 800`, `OCTOPUS_MEMORY=off` env var disables it entirely. No `skillContext` → no retrieval.

### 2. Outcome Recording on Session Completion (`packages/work-core/src/engine.ts`)

When a session reaches a terminal state, iterate `session.injectionPlanIds` (now part of session state and snapshot) and record outcomes:

```ts
for (const planId of session.injectionPlanIds ?? []) {
  await memory.recordInjectionOutcome(planId, {
    sessionOutcome: session.terminalState,    // 'completed' | 'failed' | 'aborted'
    artifactsProduced: session.artifactCount,
  });
}
```

Putting `injectionPlanIds` on `WorkSession` (not just in trace) means outcome recording does not depend on trace replay, and snapshot/restore preserves the link.

### 3. Surface: CLI Promote Command (`packages/surfaces-cli`)

The CLI commands listed under "Public API Additions" wire to `MemoryPort.promoteFromSource`. Each invocation prints a one-line summary and the resulting `MemoryId`. Output of `octopus memory promote` always includes the resolved source kind and the chosen skill so the user can verify before walking away.

The agent tool path (`memory.promote(...)` callable by the runtime) is **defined but not wired** in Phase 1 — the binding exists in `packages/memory`, but no runtime adapter registers it. Activation is gated behind `OCTOPUS_MEMORY_AGENT_WRITE=on` plus a session-level capability grant in Phase 2.

## Relationship with the Octopus_mem Repository

After this work lands:

| Repository | Role |
|---|---|
| `octopus` (this repo) | Owns `@octopus/memory` and its on-disk format end-to-end. Fully self-contained. |
| `Octopus_mem` (sibling repo) | Continues to evolve independently. Provides a Python implementation and CLI for users who want it for non-Octopus purposes. **Not modified by this work, not depended on by Octopus.** |

There is **no shared format contract** between the two. The conceptual lineage is acknowledged but the file formats and code are independent. This was an explicit user decision to avoid cross-repo coordination cost.

If a future need arises to interoperate (e.g., let the Python CLI read Octopus's files), the adapter work belongs in whichever side wants the interop, not in this spec.

## Phased Roadmap

### Phase 1 — Read-only injection + manual promotion + CLI surface (target: this iteration)

- `@octopus/memory` package created with the schemas, filesystem store, keyword retriever, planner, formatter, source-anchored promotion API, outcome recorder.
- Engine integration for retrieval + injection (skill scope only, opt-in via `session.skillContext`).
- CLI `octopus memory promote / list / show / reject` with the three source modes.
- Trace emits `memory.retrieved`, `memory.injected`, `memory.promoted`, `memory.outcome`.
- Env flags: `OCTOPUS_MEMORY=off|on` (default on), `OCTOPUS_MEMORY_AGENT_WRITE=off|on` (default off).
- Validation: 10+ manually promoted dev-skill memories; one A/B comparison session showing trace differences with memory on vs off.

### Phase 2 — Promotion candidates + agent write tool + Web surface

- A `promoteCandidates` extractor reads completed session traces and proposes records (status `candidate`); CLI `octopus memory review` walks them.
- Agent tool `memory.promote` enabled behind a per-session capability grant.
- Outcome recorder begins influencing retrieval ranking (verified records boosted).
- `surfaces-web` injected-memories panel; `gateway` serializes `memory.*` events.

### Phase 3 — Activate `agent` and `team` scopes

- Once Octopus has a real multi-agent surface (or OPC agents start running on top of Octopus), the `agent` scope activates.
- `team` scope becomes a read-only target; only CLI can write team-level records, and only after explicit user confirmation.

### Phase 4 — Optional service / vector / sync layers

- Consider an out-of-process memory service only if multiple Octopus instances must share state.
- Consider vector retrieval only if keyword retrieval is demonstrably insufficient.
- Private memory data repo sync (git remote / submodule) only when there is real data worth syncing.

Each phase has an explicit gate: phase N+1 starts only when phase N has measurable evidence of value (see Validation Standards).

## Observability and Reversibility

These are first-class requirements, not afterthoughts.

- **Every injection is visible in the trace** via `memory.injected` events listing every included record id and every rejected record id with the rejection reason.
- **Every injection is visible in the CLI** — session start prints a one-line summary "memory: injected N items, skipped M (budget)". Web dashboard panel deferred to Phase 2.
- **A single env flag disables the entire system** — `OCTOPUS_MEMORY=off` skips the engine hook entirely and reverts to today's behavior.
- **A second flag gates agent writes** — `OCTOPUS_MEMORY_AGENT_WRITE=off` (default) means only the CLI can write memories.
- **Conservative defaults** — Phase 1 injects at most 2 records per session, with a small token budget, to keep early noise visible.
- **No silent writes** — Phase 1 has no automatic memory creation; every record is traceable to a human CLI action.
- **No skill default** — sessions without an explicit skill get no injection, ever. Better silent than wrong.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Early empty memory store causes irrelevant injections | High | Medium | Conservative top-K (1–2), explicit display of injections, kill switch, no default skill |
| Agent self-write feedback loop reinforces wrong memories | High if agent write enabled | High | Agent write disabled in Phase 1; Phase 2 enabled per-session only |
| Skill assignment wrong (memory tagged as `dev` belongs to `ops`) | Medium | Low | Phase 1 promotion is CLI-gated by humans who set the skill; classifier deferred |
| Memory overhead slows planning hot path | Low | Medium | Retrieval is local file IO + in-memory index; benchmarked against a 1k-record store before Phase 2 |
| `state-store` and `@octopus/memory` end up duplicating data anyway | Medium | High | Architectural rule: memory never copies session/workspace bytes; it indexes by reference and only persists distilled records |
| User confusion between Octopus's memory files and Octopus_mem's files | Medium | Low | `.octopus.` filename infix; documentation explicitly states the two systems are independent |
| Per-user memory location leaks across projects unintentionally | Medium | Medium | `owner.workspaceId` field on records; retrieval applies workspace filter when set |

## Validation Standards

Phase 1 is "successful" only if all four are true:

1. **At least one real session shows the model using an injected memory.** Evidence: trace shows the memory was injected and the model's planning output references it.
2. **Memory injection does not slow session start by more than 100 ms.** Evidence: micro-benchmark in `__tests__`.
3. **Disabling memory (`OCTOPUS_MEMORY=off`) returns identical behavior to pre-feature baseline.** Evidence: regression test snapshot diff is empty.
4. **A reviewer can audit every memory in the store back to a human CLI invocation.** Evidence: `operations.octopus.jsonl` replay produces the current store byte-for-byte.

If any of these fails, Phase 2 does not start; we fix Phase 1 first.

## Open Questions for User Confirmation

One remaining open question:

1. **Skill registry source of truth** — proposed: hard-coded enum (`dev / ops / content / law / finance / molt`) in `@octopus/memory/schemas/skill.ts`, exported via `@octopus/work-contracts`. Alternative: external config file. **Recommendation: hard-coded enum until skill set stabilizes; revisit at Phase 3 when `agent` scope activates.**

(Earlier open questions about memory store location and Octopus_mem format compatibility have been resolved in the body of this spec.)

---

## Appendix A — Why Not These Alternatives

**"Just use a vector DB."** Vector retrieval has no advantage over keyword search until the corpus is large and queries are semantic. Phase 1 corpus is empty or tiny; introducing a vector dep now is overhead without payoff. Phase 4 reconsiders.

**"Use Octopus_mem as a Python sidecar."** Memory is on the work-loop hot path; cross-language IPC there is a permanent operational tax. The conceptual core is small enough to absorb in TypeScript.

**"Make the on-disk format byte-compatible with Octopus_mem."** Would require modifying Octopus_mem (its current schema is `additionalProperties: false`). The user's explicit constraint is to keep Octopus_mem untouched. Therefore Octopus owns its own format.

**"Treat session and workspace as memory layers."** Octopus already persists both. Re-storing them as memory records would either duplicate bytes or fragment ownership. Instead they are *sources* (input to promotion) and *qualifiers* (filters on `skill` records).

**"Default skill to `molt` when none is specified."** Was in an earlier draft; Codex flagged it as cross-domain pollution risk. Removed in favor of explicit opt-in: no skill, no injection.

**"5 active scopes from day one."** Active scopes also mean active retrieval, ranking, conflict, and promotion rules — each of which is hard to design without real data. Schema-only reservation has the storage benefit without the policy burden.

**"Per-workspace memory store."** Considered, rejected. Skill experience is meant to follow the user across projects; per-workspace would make "I switched projects and lost my dev knowledge" a first-class problem. Workspace scoping is expressed via the `owner.workspaceId` field instead.

## Appendix B — Glossary

- **MemoryRecord** — a single stored memory with scope, owner, content, and provenance.
- **MemoryCandidate** — a record returned by `retrieve` with a relevance score, before budget selection.
- **InjectionPlan** — the set of candidates selected for inclusion in a turn's prompt, with explicit included/excluded lists.
- **Promotion** — the act of turning a session/artifact-derived observation into a stored memory record via a verifiable source.
- **Scope** — the primary owning level of a record (`session / agent / skill / workspace / team`). Phase 1 only stores `skill`.
- **Qualifier** — a secondary owner field that narrows where a record applies (e.g., `owner.workspaceId='octopus'` on a skill-scoped record).
- **Source** — the required provenance field on every record: trace-event, artifact, or explicit freeform.
