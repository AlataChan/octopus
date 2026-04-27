export type KbCommand = "lookup" | "retrieve-bundle" | "neighbors" | "impacted-pages";

export interface KbLookupInput {
  term: string;
  vaultPath: string;
}

export interface KbRawLookupCanonical {
  path: string;
  title: string;
  source_of_truth?: string | null;
}

export interface KbRawLookupAlias {
  text: string;
  resolves_to: string;
}

export interface KbRawLookupResult {
  term: string;
  canonical: KbRawLookupCanonical | null;
  aliases: KbRawLookupAlias[];
  ambiguous: boolean;
  collisions: string[];
  next: string[];
}

export interface KbRetrieveBundleInput {
  query: string;
  vaultPath: string;
  maxTokens?: number;
}

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
  token_estimate: number;
  next: string[];
}

export interface KbNeighborsInput {
  pagePath: string;
  vaultPath: string;
}

export type KbRawNeighborVia = "wikilink" | "related_entities";

export interface KbRawInboundNeighbor {
  path: string;
  via: KbRawNeighborVia;
  count: number;
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

export interface KbImpactedPagesInput {
  pagePath: string;
  vaultPath: string;
}

export interface KbRawImpactedPagesResult {
  page: string;
  impacted: string[];
  next: string[];
}

export interface KbNormalizedCanonical {
  path: string;
  title: string;
  sourceOfTruth: string | null;
}

export interface KbNormalizedEvidenceItem {
  path: string;
  title: string;
  reason: KbRawBundlePageReason;
  bucket: "concepts" | "entities" | "raw_sources";
}

export interface KbNormalizedEvidence {
  items: KbNormalizedEvidenceItem[];
  warnings: KbRawBundleWarning[];
  tokenEstimate: number;
}

export interface KbNormalizedNeighbors {
  inbound: KbRawInboundNeighbor[];
  outbound: KbRawOutboundNeighbor[];
  canonicalIdentity: string | null;
}

export interface PlanningEnrichmentInput {
  query: string;
  vaultPath: string;
  tokenBudget: number;
}

export interface PlanningEnrichmentStep {
  step: "lookup" | "retrieve-bundle" | "neighbors";
  ms: number;
  ok: boolean;
  skippedReason?: "budget_exhausted" | "no_canonical" | "kb_unavailable";
}

export interface PlanningEnrichmentResult {
  canonical: KbNormalizedCanonical | null;
  aliases: KbRawLookupAlias[];
  ambiguous: boolean;
  evidence: KbNormalizedEvidence | null;
  neighbors: KbNormalizedNeighbors | null;
  steps: PlanningEnrichmentStep[];
}

export type KbAvailability =
  | { ok: true; version: string | "unknown" }
  | { ok: false; reason: string };
