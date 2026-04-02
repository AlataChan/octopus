import { describe, expect, it } from "vitest";

import type { RiskLevel } from "@octopus/work-contracts";
import type { RiskLevel as RiskLevelFromSecurity } from "../policy.js";

describe("RiskLevel re-export", () => {
  it("security package re-exports RiskLevel from work-contracts", () => {
    // If this compiles, the re-export is correct
    const level: RiskLevelFromSecurity = "dangerous";
    expect(level).toBe("dangerous");
  });

  it("all three risk levels are valid", () => {
    const levels: RiskLevel[] = ["safe", "consequential", "dangerous"];
    expect(levels).toHaveLength(3);
  });
});
