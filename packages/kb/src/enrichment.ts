import type { KbPort } from "./port.js";
import type {
  KbNormalizedEvidence,
  KbNormalizedNeighbors,
  KbRawLookupCanonical,
  KbRawRetrieveBundleResult,
  PlanningEnrichmentInput,
  PlanningEnrichmentResult,
  PlanningEnrichmentStep,
} from "./types.js";

export async function enrichPlanningContext(
  port: KbPort,
  input: PlanningEnrichmentInput
): Promise<PlanningEnrichmentResult> {
  const steps: PlanningEnrichmentStep[] = [];

  const lookupStart = Date.now();
  const lookup = await port.lookup({ term: input.query, vaultPath: input.vaultPath });
  steps.push({ step: "lookup", ms: Date.now() - lookupStart, ok: true });

  const evidence =
    input.tokenBudget > 0
      ? await timedStep(steps, "retrieve-bundle", async () =>
          normalizeEvidence(
            await port.retrieveBundle({
              query: input.query,
              vaultPath: input.vaultPath,
              maxTokens: input.tokenBudget,
            })
          )
        )
      : skipStep(steps, "retrieve-bundle", "budget_exhausted", null);

  const canonicalPath = lookup.canonical?.path;
  const neighbors = canonicalPath
    ? await timedStep(steps, "neighbors", async () =>
        normalizeNeighbors(
          await port.neighbors({
            pagePath: canonicalPath,
            vaultPath: input.vaultPath,
          })
        )
      )
    : skipStep(steps, "neighbors", "no_canonical", null);

  return {
    canonical: lookup.canonical ? normalizeCanonical(lookup.canonical) : null,
    aliases: lookup.aliases,
    ambiguous: lookup.ambiguous,
    evidence,
    neighbors,
    steps,
  };
}

function normalizeCanonical(raw: KbRawLookupCanonical) {
  return {
    path: raw.path,
    title: raw.title,
    sourceOfTruth: raw.source_of_truth ?? null,
  };
}

function normalizeEvidence(raw: KbRawRetrieveBundleResult): KbNormalizedEvidence {
  return {
    items: [
      ...raw.bundle.concepts.map((item) => ({ ...item, bucket: "concepts" as const })),
      ...raw.bundle.entities.map((item) => ({ ...item, bucket: "entities" as const })),
      ...raw.bundle.raw_sources.map((item) => ({ ...item, bucket: "raw_sources" as const })),
    ],
    warnings: raw.warnings,
    tokenEstimate: raw.token_estimate,
  };
}

function normalizeNeighbors(raw: {
  inbound: KbNormalizedNeighbors["inbound"];
  outbound: KbNormalizedNeighbors["outbound"];
  canonical_identity: string | null;
}): KbNormalizedNeighbors {
  return {
    inbound: raw.inbound,
    outbound: raw.outbound,
    canonicalIdentity: raw.canonical_identity,
  };
}

async function timedStep<T>(
  steps: PlanningEnrichmentStep[],
  step: PlanningEnrichmentStep["step"],
  run: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const result = await run();
  steps.push({ step, ms: Date.now() - startedAt, ok: true });
  return result;
}

function skipStep<T>(
  steps: PlanningEnrichmentStep[],
  step: PlanningEnrichmentStep["step"],
  skippedReason: NonNullable<PlanningEnrichmentStep["skippedReason"]>,
  result: T
): T {
  steps.push({ step, ms: 0, ok: false, skippedReason });
  return result;
}
