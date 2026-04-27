import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  KbRawImpactedPagesResult,
  KbRawLookupResult,
  KbRawNeighborsResult,
  KbRawRetrieveBundleResult,
} from "./types.js";

const lookupCanonicalSchema = z
  .object({
    path: z.string(),
    title: z.string(),
    source_of_truth: z.string().nullable().optional(),
  })
  .strict();

const lookupAliasSchema = z
  .object({
    text: z.string(),
    resolves_to: z.string(),
  })
  .strict();

export const kbLookupResultSchema = z
  .object({
    term: z.string(),
    canonical: z.union([lookupCanonicalSchema, z.null()]),
    aliases: z.array(lookupAliasSchema),
    ambiguous: z.boolean(),
    collisions: z.array(z.string()),
    next: z.array(z.string()),
  })
  .strict();

const bundlePageReasonSchema = z.enum([
  "title_match",
  "alias_match",
  "related_entities",
  "backlink",
  "schema_anchor",
  "index_anchor",
  "log_anchor",
]);

const bundlePageSchema = z
  .object({
    path: z.string(),
    title: z.string(),
    reason: bundlePageReasonSchema,
  })
  .strict();

const bundleWarningSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .strict();

export const kbRetrieveBundleResultSchema = z
  .object({
    query: z.string(),
    bundle: z
      .object({
        schema: z.array(z.string()),
        index: z.array(z.string()),
        concepts: z.array(bundlePageSchema),
        entities: z.array(bundlePageSchema),
        raw_sources: z.array(bundlePageSchema),
      })
      .strict(),
    warnings: z.array(bundleWarningSchema),
    token_estimate: z.number().int().min(0),
    next: z.array(z.string()),
  })
  .strict();

const neighborViaSchema = z.enum(["wikilink", "related_entities"]);

const inboundNeighborSchema = z
  .object({
    path: z.string(),
    via: neighborViaSchema,
    count: z.number().int().min(1),
  })
  .strict();

const outboundNeighborSchema = z
  .object({
    path: z.string(),
    via: neighborViaSchema,
  })
  .strict();

export const kbNeighborsResultSchema = z
  .object({
    page: z.string(),
    inbound: z.array(inboundNeighborSchema),
    outbound: z.array(outboundNeighborSchema),
    aliases: z.array(z.string()),
    canonical_identity: z.string().nullable(),
    next: z.array(z.string()),
  })
  .strict();

export const kbImpactedPagesResultSchema = z
  .object({
    page: z.string(),
    impacted: z.array(z.string()),
    next: z.array(z.string()),
  })
  .strict();

export const KB_SCHEMA_HASHES = {
  lookup: hashSchema(kbLookupResultSchema),
  "retrieve-bundle": hashSchema(kbRetrieveBundleResultSchema),
  neighbors: hashSchema(kbNeighborsResultSchema),
  "impacted-pages": hashSchema(kbImpactedPagesResultSchema),
} as const;

export function parseKbLookupResult(input: unknown): KbRawLookupResult {
  return kbLookupResultSchema.parse(input);
}

export function parseKbRetrieveBundleResult(input: unknown): KbRawRetrieveBundleResult {
  return kbRetrieveBundleResultSchema.parse(input);
}

export function parseKbNeighborsResult(input: unknown): KbRawNeighborsResult {
  return kbNeighborsResultSchema.parse(input);
}

export function parseKbImpactedPagesResult(input: unknown): KbRawImpactedPagesResult {
  return kbImpactedPagesResultSchema.parse(input);
}

function hashSchema(schema: z.ZodTypeAny): string {
  return createHash("sha256").update(JSON.stringify(schema._def)).digest("hex");
}
