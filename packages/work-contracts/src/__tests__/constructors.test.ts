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
    expect(session.workspaceId).toBe("default");
    expect(session.configProfileId).toBe("default");
    expect(session.state).toBe("created");
    expect(session.items).toEqual([]);
    expect(session.observations).toEqual([]);
    expect(session.artifacts).toEqual([]);
    expect(session.transitions).toEqual([]);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });

  it("creates a work session with release metadata overrides", () => {
    const goal = createWorkGoal({ description: "Audit repo" });
    const session = createWorkSession(goal, {
      workspaceId: "workspace-a",
      configProfileId: "profile-a",
      createdBy: "ops@example.com",
      taskTitle: "README 摘要"
    });

    expect(session.workspaceId).toBe("workspace-a");
    expect(session.configProfileId).toBe("profile-a");
    expect(session.createdBy).toBe("ops@example.com");
    expect(session.taskTitle).toBe("README 摘要");
  });
});
