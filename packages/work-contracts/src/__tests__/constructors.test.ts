import { describe, expect, it } from "vitest";

import { createWorkGoal, createWorkSession } from "../factories.js";

describe("work-contract constructors", () => {
  it("creates a work goal with defaults", () => {
    const goal = createWorkGoal({
      description: "Ship phase 1",
      namedGoalId: "daily-report"
    });

    expect(goal.id).toBeTypeOf("string");
    expect(goal.description).toBe("Ship phase 1");
    expect(goal.constraints).toEqual([]);
    expect(goal.successCriteria).toEqual([]);
    expect(goal.createdAt).toBeInstanceOf(Date);
    expect(goal.namedGoalId).toBe("daily-report");
  });

  it("creates a fresh work session for a goal", () => {
    const goal = createWorkGoal({ description: "Audit repo", namedGoalId: "audit-repo" });
    const session = createWorkSession(goal);

    expect(session.goalId).toBe(goal.id);
    expect(session.namedGoalId).toBe("audit-repo");
    expect(session.state).toBe("created");
    expect(session.items).toEqual([]);
    expect(session.observations).toEqual([]);
    expect(session.artifacts).toEqual([]);
    expect(session.transitions).toEqual([]);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });
});
