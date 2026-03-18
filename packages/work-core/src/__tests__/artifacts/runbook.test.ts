import { describe, expect, it } from "vitest";

import type { WorkEvent } from "@octopus/observability";
import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { renderRunbook } from "../../artifacts/templates.js";

describe("runbook generation", () => {
  it("renders ordered steps and verification summary from session state and trace events", () => {
    const goal = createWorkGoal({
      description: "Normalize files",
      constraints: ["Use processed/ output"]
    });
    const session = createWorkSession(goal);
    session.state = "completed";
    session.items.push({
      id: "item-1",
      sessionId: session.id,
      description: "Patch output file",
      state: "done",
      observations: [],
      actions: [
        {
          id: "action-1",
          type: "patch",
          params: { path: "processed/output.txt" },
          result: { success: true, output: "processed/output.txt" },
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        }
      ],
      verifications: [
        {
          id: "verification-1",
          method: "manual",
          passed: true,
          evidence: "verified",
          createdAt: new Date("2026-03-18T00:01:00.000Z")
        }
      ],
      createdAt: new Date("2026-03-18T00:00:00.000Z")
    });

    const events: WorkEvent[] = [
      {
        id: "event-1",
        timestamp: new Date("2026-03-18T00:00:00.000Z"),
        sessionId: session.id,
        goalId: session.goalId,
        type: "file.patched",
        sourceLayer: "substrate",
        payload: {
          path: "processed/output.txt",
          operation: "update",
          bytesWritten: 42
        }
      }
    ];

    const runbook = renderRunbook(session, goal, events);

    expect(runbook).toContain("Runbook: Normalize files");
    expect(runbook).toContain("Patch output file");
    expect(runbook).toContain("processed/output.txt");
    expect(runbook).toContain("Verification Summary");
  });
});
