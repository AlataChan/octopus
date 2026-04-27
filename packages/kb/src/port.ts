import type {
  KbAvailability,
  KbImpactedPagesInput,
  KbLookupInput,
  KbNeighborsInput,
  KbRawImpactedPagesResult,
  KbRawLookupResult,
  KbRawNeighborsResult,
  KbRawRetrieveBundleResult,
  KbRetrieveBundleInput,
} from "./types.js";

export interface KbPort {
  lookup(input: KbLookupInput): Promise<KbRawLookupResult>;
  retrieveBundle(input: KbRetrieveBundleInput): Promise<KbRawRetrieveBundleResult>;
  neighbors(input: KbNeighborsInput): Promise<KbRawNeighborsResult>;
  impactedPages(input: KbImpactedPagesInput): Promise<KbRawImpactedPagesResult>;
  available(): Promise<KbAvailability>;
}
