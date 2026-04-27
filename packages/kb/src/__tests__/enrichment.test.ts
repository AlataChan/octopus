import { describe, expect, it } from "vitest";

import { enrichPlanningContext } from "../enrichment.js";
import type { KbPort } from "../port.js";

describe("enrichPlanningContext", () => {
  it("normalizes lookup, evidence, and neighbor results from the raw port", async () => {
    const port: KbPort = {
      async available() {
        return { ok: true, version: "0.6.0" };
      },
      async lookup() {
        return {
          term: "RAG Ops",
          canonical: {
            path: "wiki/concepts/RAG Operations.md",
            title: "RAG Operations",
            source_of_truth: "canonical",
          },
          aliases: [{ text: "RAG Ops", resolves_to: "wiki/concepts/RAG Operations.md" }],
          ambiguous: false,
          collisions: [],
          next: [],
        };
      },
      async retrieveBundle() {
        return {
          query: "RAG Ops",
          bundle: {
            schema: ["AGENTS.md"],
            index: ["wiki/INDEX.md"],
            concepts: [{ path: "wiki/concepts/RAG Operations.md", title: "RAG Operations", reason: "title_match" }],
            entities: [{ path: "wiki/entities/Vector Store.md", title: "Vector Store", reason: "related_entities" }],
            raw_sources: [],
          },
          warnings: [],
          token_estimate: 90,
          next: [],
        };
      },
      async neighbors() {
        return {
          page: "wiki/concepts/RAG Operations.md",
          inbound: [{ path: "wiki/INDEX.md", via: "wikilink", count: 1 }],
          outbound: [{ path: "wiki/entities/Vector Store.md", via: "related_entities" }],
          aliases: ["RAG Ops"],
          canonical_identity: "RAG Operations",
          next: [],
        };
      },
      async impactedPages() {
        return {
          page: "wiki/concepts/RAG Operations.md",
          impacted: [],
          next: [],
        };
      },
    };

    const result = await enrichPlanningContext(port, {
      query: "RAG Ops",
      vaultPath: "/vault",
      tokenBudget: 500,
    });

    expect(result.canonical?.path).toBe("wiki/concepts/RAG Operations.md");
    expect(result.evidence?.items.map((item) => item.bucket)).toEqual(["concepts", "entities"]);
    expect(result.neighbors?.canonicalIdentity).toBe("RAG Operations");
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["lookup", true],
      ["retrieve-bundle", true],
      ["neighbors", true],
    ]);
  });
});
