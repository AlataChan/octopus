import { describe, expect, it } from "vitest";

import { isCompletable } from "../completion.js";

describe("isCompletable", () => {
  it("returns true when completion evidence is fully satisfied", () => {
    expect(
      isCompletable({
        targetArtifactExists: true,
        verificationPassed: true,
        noUnresolvedPartials: true,
        limitationsPersisted: true,
        stateDurable: true
      })
    ).toBe(true);
  });

  it("returns false when a partial result has no explicit override", () => {
    expect(
      isCompletable({
        targetArtifactExists: true,
        verificationPassed: true,
        noUnresolvedPartials: false,
        limitationsPersisted: true,
        stateDurable: true
      })
    ).toBe(false);
  });

  it("allows completion when a partial override is explicitly granted", () => {
    expect(
      isCompletable({
        targetArtifactExists: true,
        verificationPassed: true,
        noUnresolvedPartials: false,
        limitationsPersisted: true,
        stateDurable: true,
        partialOverrideGranted: true
      })
    ).toBe(true);
  });
});
