import { describe, expect, it } from "vitest";

import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { hydrateWorkSession, serializeWorkSession } from "../session-serde.js";

describe("serializeWorkSession / hydrateWorkSession blockedReason", () => {
  it("round-trips blockedReason through serialize/hydrate", () => {
    const goal = createWorkGoal({ description: "Test blocked reason" });
    const session = createWorkSession(goal);
    session.state = "blocked";
    (session as any).blockedReason = {
      kind: "clarification-required",
      question: "Which directory should I use?"
    };

    const stored = serializeWorkSession(session);
    const restored = hydrateWorkSession(stored);

    expect(restored.blockedReason?.kind).toBe("clarification-required");
    expect(restored.blockedReason?.question).toBe("Which directory should I use?");
  });

  it("round-trips session without blockedReason as undefined", () => {
    const goal = createWorkGoal({ description: "Test no blocked reason" });
    const session = createWorkSession(goal);

    const stored = serializeWorkSession(session);
    const restored = hydrateWorkSession(stored);

    expect(restored.blockedReason).toBeUndefined();
  });

  it("round-trips release metadata and preserves optional fields", () => {
    const goal = createWorkGoal({ description: "Test release metadata" });
    const session = createWorkSession(goal, {
      workspaceId: "workspace-a",
      configProfileId: "profile-a",
      createdBy: "operator-1",
      taskTitle: "README 摘要",
      skillContext: "dev"
    });
    session.goalSummary = "读取 README 并整理为中文摘要";
    session.injectionPlanIds = ["plan-1", "plan-2"];

    const stored = serializeWorkSession(session);
    const restored = hydrateWorkSession(stored);

    expect(stored.workspaceId).toBe("workspace-a");
    expect(stored.configProfileId).toBe("profile-a");
    expect(stored.createdBy).toBe("operator-1");
    expect(stored.taskTitle).toBe("README 摘要");
    expect(restored.workspaceId).toBe("workspace-a");
    expect(restored.configProfileId).toBe("profile-a");
    expect(restored.createdBy).toBe("operator-1");
    expect(restored.taskTitle).toBe("README 摘要");
    expect(restored.goalSummary).toBe("读取 README 并整理为中文摘要");
    expect(restored.skillContext).toBe("dev");
    expect(restored.injectionPlanIds).toEqual(["plan-1", "plan-2"]);
  });

  it("hydrates legacy sessions without scope metadata using release defaults", () => {
    const goal = createWorkGoal({ description: "Legacy session" });
    const session = createWorkSession(goal);

    const stored = serializeWorkSession(session) as unknown as Record<string, unknown>;
    delete stored.workspaceId;
    delete stored.configProfileId;
    delete stored.createdBy;
    delete stored.taskTitle;
    delete stored.injectionPlanIds;

    const restored = hydrateWorkSession(stored as unknown as ReturnType<typeof serializeWorkSession>);

    expect(restored.workspaceId).toBe("default");
    expect(restored.configProfileId).toBe("default");
    expect(restored.createdBy).toBeUndefined();
    expect(restored.taskTitle).toBeUndefined();
    expect(restored.skillContext).toBeUndefined();
    expect(restored.injectionPlanIds).toBeUndefined();
  });
});
