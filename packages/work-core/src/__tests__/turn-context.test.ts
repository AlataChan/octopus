import { describe, expect, it } from "vitest";

import { checkBudget, initTurnContext, truncateResult } from "../turn-context.js";

describe("TurnContext", () => {
  describe("initTurnContext", () => {
    it("initializes with defaults", () => {
      const ctx = initTurnContext({});
      expect(ctx.turnIndex).toBe(0);
      expect(ctx.maxIterations).toBe(20);
      expect(ctx.totalInputTokens).toBe(0);
      expect(ctx.totalOutputTokens).toBe(0);
      expect(ctx.tokenBudgetUsed).toBe(0);
      expect(ctx.cumulativeCostUsd).toBe(0);
      expect(ctx.compactMarkers).toEqual([]);
    });

    it("respects provided options", () => {
      const ctx = initTurnContext({
        maxIterations: 10,
        budget: { maxTokens: 50000, maxCostUsd: 1.0 }
      });
      expect(ctx.maxIterations).toBe(10);
      expect(ctx.budget.maxTokens).toBe(50000);
      expect(ctx.budget.maxCostUsd).toBe(1.0);
    });

    it("reconstructs counters from persisted session usage", () => {
      const ctx = initTurnContext({
        usage: {
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          estimatedCostUsd: 0.12,
          wallClockMs: 2500,
          turnCount: 3
        }
      });

      expect(ctx.turnIndex).toBe(3);
      expect(ctx.totalInputTokens).toBe(1000);
      expect(ctx.totalOutputTokens).toBe(500);
      expect(ctx.tokenBudgetUsed).toBe(1500);
      expect(ctx.cumulativeCostUsd).toBe(0.12);
      expect(Date.now() - ctx.wallClockStartMs).toBeGreaterThanOrEqual(2400);
    });
  });

  describe("truncateResult", () => {
    it("returns short outputs unchanged", () => {
      expect(truncateResult("short output")).toBe("short output");
    });

    it("truncates outputs exceeding 4096 chars", () => {
      const long = "x".repeat(5000);
      const result = truncateResult(long);
      expect(result.length).toBeLessThan(long.length);
      expect(result).toContain("[...truncated");
      expect(result.startsWith("x".repeat(100))).toBe(true);
      expect(result.endsWith("x".repeat(100))).toBe(true);
    });
  });

  describe("checkBudget", () => {
    it("returns null when within budget", () => {
      const ctx = initTurnContext({ budget: { maxTokens: 100000 } });
      ctx.tokenBudgetUsed = 50000;
      expect(checkBudget(ctx)).toBeNull();
    });

    it("returns failure when tokens exceeded", () => {
      const ctx = initTurnContext({ budget: { maxTokens: 100000 } });
      ctx.tokenBudgetUsed = 100001;
      const failure = checkBudget(ctx);
      expect(failure?.dimension).toBe("tokens");
    });

    it("returns failure when cost exceeded", () => {
      const ctx = initTurnContext({ budget: { maxCostUsd: 0.5 } });
      ctx.cumulativeCostUsd = 0.51;
      const failure = checkBudget(ctx);
      expect(failure?.dimension).toBe("cost");
    });

    it("returns failure when wall clock exceeded", () => {
      const ctx = initTurnContext({ budget: { maxWallClockMs: 1000 } });
      ctx.wallClockStartMs = Date.now() - 1500;
      const failure = checkBudget(ctx);
      expect(failure?.dimension).toBe("time");
    });

    it("returns null when no budget limits set", () => {
      const ctx = initTurnContext({});
      ctx.tokenBudgetUsed = 999999;
      expect(checkBudget(ctx)).toBeNull();
    });
  });
});
