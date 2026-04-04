import type { BudgetLimits, SessionUsage } from "@octopus/work-contracts";

export interface TurnContext {
  turnIndex: number;
  maxIterations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  tokenBudgetUsed: number;
  cumulativeCostUsd: number;
  wallClockStartMs: number;
  compactMarkers: number[];
  budget: BudgetLimits;
}

export interface BudgetFailure {
  dimension: "tokens" | "cost" | "time";
  current: number;
  limit: number;
  message: string;
}

const TRUNCATION_THRESHOLD = 4096;
const TRUNCATION_HEAD = 2048;
const TRUNCATION_TAIL = 1024;

export function initTurnContext(options: {
  maxIterations?: number;
  budget?: BudgetLimits;
  usage?: SessionUsage;
}): TurnContext {
  const usage = options.usage;
  const totalInputTokens = usage?.totalInputTokens ?? 0;
  const totalOutputTokens = usage?.totalOutputTokens ?? 0;

  return {
    turnIndex: usage?.turnCount ?? 0,
    maxIterations: options.maxIterations ?? 20,
    totalInputTokens,
    totalOutputTokens,
    tokenBudgetUsed: totalInputTokens + totalOutputTokens,
    cumulativeCostUsd: usage?.estimatedCostUsd ?? 0,
    wallClockStartMs: Date.now() - (usage?.wallClockMs ?? 0),
    compactMarkers: [],
    budget: options.budget ?? {}
  };
}

export function truncateResult(output: string): string {
  if (output.length <= TRUNCATION_THRESHOLD) {
    return output;
  }

  const truncatedCount = output.length - TRUNCATION_HEAD - TRUNCATION_TAIL;
  return (
    output.slice(0, TRUNCATION_HEAD)
    + `\n[...truncated ${truncatedCount} characters...]\n`
    + output.slice(-TRUNCATION_TAIL)
  );
}

export function checkBudget(ctx: TurnContext): BudgetFailure | null {
  if (ctx.budget.maxTokens !== undefined && ctx.tokenBudgetUsed > ctx.budget.maxTokens) {
    return {
      dimension: "tokens",
      current: ctx.tokenBudgetUsed,
      limit: ctx.budget.maxTokens,
      message: `Token budget exceeded: ${ctx.tokenBudgetUsed} / ${ctx.budget.maxTokens}`
    };
  }

  if (ctx.budget.maxCostUsd !== undefined && ctx.cumulativeCostUsd > ctx.budget.maxCostUsd) {
    return {
      dimension: "cost",
      current: ctx.cumulativeCostUsd,
      limit: ctx.budget.maxCostUsd,
      message: `Cost budget exceeded: $${ctx.cumulativeCostUsd.toFixed(4)} / $${ctx.budget.maxCostUsd.toFixed(2)}`
    };
  }

  if (ctx.budget.maxWallClockMs !== undefined) {
    const elapsed = Date.now() - ctx.wallClockStartMs;
    if (elapsed > ctx.budget.maxWallClockMs) {
      return {
        dimension: "time",
        current: elapsed,
        limit: ctx.budget.maxWallClockMs,
        message: `Time budget exceeded: ${elapsed}ms / ${ctx.budget.maxWallClockMs}ms`
      };
    }
  }

  return null;
}
