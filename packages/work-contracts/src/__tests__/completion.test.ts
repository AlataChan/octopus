import { describe, expect, it } from "vitest";

import { isCompletable } from "../completion.js";

describe("isCompletable", () => {
  it("returns true only when every evidence flag is present", () => {
    expect(
      isCompletable({
        targetArtifactExists: true,
        verificationRecorded: true,
        limitationsPersisted: true,
        stateDurable: true
      })
    ).toBe(true);
  });

  it("returns false when any evidence flag is missing", () => {
    expect(
      isCompletable({
        targetArtifactExists: true,
        verificationRecorded: true,
        limitationsPersisted: false,
        stateDurable: true
      })
    ).toBe(false);
  });
});

