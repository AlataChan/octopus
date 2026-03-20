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
});
