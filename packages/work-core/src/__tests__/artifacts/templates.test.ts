import { describe, expect, it } from "vitest";

import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { renderPlan, renderStatus, renderTodo } from "../../artifacts/templates.js";

describe("artifact templates", () => {
  it("renders plan, todo, and status content from the session model", () => {
    const goal = createWorkGoal({
      description: "Ship phase 2",
      constraints: ["Keep traces readable"],
      successCriteria: ["Tests pass"]
    });
    const session = createWorkSession(goal);
    session.state = "active";
    session.items.push({
      id: "item-1",
      sessionId: session.id,
      description: "Implement lock handling",
      state: "active",
      observations: [],
      actions: [],
      verifications: [],
      createdAt: new Date("2026-03-18T00:00:00.000Z")
    });

    expect(renderPlan(session, goal)).toContain("Ship phase 2");
    expect(renderPlan(session, goal)).toContain("Keep traces readable");
    expect(renderTodo(session.items)).toContain("Implement lock handling");
    expect(renderStatus(session)).toContain("Session: active");
  });
});
