import { describe, expect, it } from "vitest";

import {
  parseKbImpactedPagesResult,
  parseKbLookupResult,
  parseKbNeighborsResult,
  parseKbRetrieveBundleResult,
} from "../schemas.js";

describe("@octopus/kb schemas", () => {
  it("accepts lookup canonical payload without optional source_of_truth", () => {
    const result = parseKbLookupResult({
      term: "RAG Ops",
      canonical: {
        path: "wiki/concepts/RAG Operations.md",
        title: "RAG Operations",
      },
      aliases: [{ text: "RAG Ops", resolves_to: "wiki/concepts/RAG Operations.md" }],
      ambiguous: false,
      collisions: [],
      next: ["octopus-kb retrieve-bundle \"wiki/concepts/RAG Operations.md\" --vault \"/vault\" --json"],
    });

    expect(result.canonical?.source_of_truth).toBeUndefined();
  });

  it("accepts retrieve-bundle output in the real octopus-kb shape", () => {
    const result = parseKbRetrieveBundleResult({
      query: "RAG Ops",
      bundle: {
        schema: ["AGENTS.md"],
        index: ["wiki/INDEX.md"],
        concepts: [{ path: "wiki/concepts/RAG.md", title: "RAG", reason: "title_match" }],
        entities: [{ path: "wiki/entities/Vector Store.md", title: "Vector Store", reason: "related_entities" }],
        raw_sources: [{ path: "raw/source.md", title: "Source", reason: "backlink" }],
      },
      warnings: [{ code: "trimmed", message: "raw sources trimmed" }],
      token_estimate: 120,
      next: ["octopus-kb neighbors wiki/concepts/RAG.md --vault /vault --json"],
    });

    expect(result.bundle.concepts[0]?.reason).toBe("title_match");
    expect(result.token_estimate).toBe(120);
  });

  it("accepts neighbors and impacted-pages output in the real octopus-kb shape", () => {
    const neighbors = parseKbNeighborsResult({
      page: "wiki/concepts/RAG.md",
      inbound: [{ path: "wiki/INDEX.md", via: "wikilink", count: 1 }],
      outbound: [{ path: "wiki/entities/Vector Store.md", via: "related_entities" }],
      aliases: ["RAG Ops"],
      canonical_identity: "RAG",
      next: [],
    });
    const impacted = parseKbImpactedPagesResult({
      page: "wiki/concepts/RAG.md",
      impacted: ["wiki/INDEX.md", "wiki/LOG.md"],
      next: [],
    });

    expect(neighbors.inbound[0]?.count).toBe(1);
    expect(impacted.impacted).toEqual(["wiki/INDEX.md", "wiki/LOG.md"]);
  });
});
