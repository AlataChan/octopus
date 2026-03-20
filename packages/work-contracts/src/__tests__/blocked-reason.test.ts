import { describe, expect, it } from "vitest";
import type { BlockedReason, ApprovalFingerprint, RiskLevel } from "../types.js";
import { createWorkGoal, createWorkSession } from "../factories.js";

describe("BlockedReason", () => {
  it("WorkSession.blockedReason is optional and undefined by default", () => {
    const goal = createWorkGoal({ description: "test" });
    const session = createWorkSession(goal);
    expect(session.blockedReason).toBeUndefined();
  });

  it("accepts clarification-required kind", () => {
    const reason: BlockedReason = { kind: "clarification-required", question: "Which path?" };
    expect(reason.kind).toBe("clarification-required");
    expect(reason.question).toBe("Which path?");
  });

  it("accepts approval-required kind with ApprovalFingerprint", () => {
    const approval: ApprovalFingerprint = {
      actionId: "act-1",
      actionType: "shell",
      fingerprint: "sha256:abc123",
    };
    const reason: BlockedReason = {
      kind: "approval-required",
      approval,
      riskLevel: "dangerous",
    };
    expect(reason.approval?.fingerprint).toBe("sha256:abc123");
    expect(reason.approval?.actionType).toBe("shell");
    expect(reason.riskLevel).toBe("dangerous");
  });

  it("accepts verification-failed kind with structured evidence", () => {
    const reason: BlockedReason = {
      kind: "verification-failed",
      evidence: "type-check failed",
      verificationDetails: [{ label: "tsc", value: "TS2345: error", passed: false }],
    };
    expect(reason.verificationDetails).toHaveLength(1);
    expect(reason.verificationDetails![0].passed).toBe(false);
  });
});

describe("RiskLevel (source of truth in work-contracts)", () => {
  it("accepts all valid risk levels", () => {
    const levels: RiskLevel[] = ["safe", "consequential", "dangerous"];
    expect(levels).toHaveLength(3);
  });
});
