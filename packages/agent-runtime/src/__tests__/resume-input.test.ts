import { describe, expect, it } from "vitest";
import type { ResumeInput } from "../types.js";

describe("ResumeInput", () => {
  it("accepts clarification kind", () => {
    const input: ResumeInput = { kind: "clarification", answer: "Yes, use /tmp" };
    expect(input.kind).toBe("clarification");
    if (input.kind === "clarification") {
      expect(input.answer).toBe("Yes, use /tmp");
    }
  });

  it("accepts approval kind with approve decision", () => {
    const input: ResumeInput = { kind: "approval", decision: "approve" };
    expect(input.kind).toBe("approval");
    if (input.kind === "approval") {
      expect(input.decision).toBe("approve");
    }
  });

  it("accepts approval kind with reject decision", () => {
    const input: ResumeInput = { kind: "approval", decision: "reject" };
    if (input.kind === "approval") {
      expect(input.decision).toBe("reject");
    }
  });

  it("accepts operator kind with no additional payload", () => {
    const input: ResumeInput = { kind: "operator" };
    expect(input.kind).toBe("operator");
  });
});
