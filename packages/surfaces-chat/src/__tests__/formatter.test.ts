import { describe, expect, it } from "vitest";

import { formatCompletionNotification } from "../slack/formatter.js";

describe("formatCompletionNotification", () => {
  it("formats a completion notification", () => {
    const payload = formatCompletionNotification(
      {
        id: "session-1",
        state: "completed",
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:01:00.000Z",
        artifacts: [{ id: "artifact-1" }, { id: "artifact-2" }]
      },
      "Clean up temp directory"
    );

    expect(payload.text).toContain("Goal Complete");
    expect(payload.blocks[0]?.text.text).toContain("Goal Complete");
    expect(payload.blocks[1]?.text.text).toContain("session-1");
    expect(payload.blocks[1]?.text.text).toContain("Clean up temp directory");
    expect(payload.blocks[1]?.text.text).toContain("Artifacts: 2");
    expect(payload.blocks[1]?.text.text).toContain("Duration: 1m 0s");
  });

  it("formats a failure notification", () => {
    const payload = formatCompletionNotification(
      {
        id: "session-2",
        state: "failed",
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:00:30.000Z",
        artifacts: [],
        error: "Shell command failed"
      },
      "Deploy docs"
    );

    expect(payload.text).toContain("Goal Failed");
    expect(payload.blocks[0]?.text.text).toContain("Goal Failed");
    expect(payload.blocks[1]?.text.text).toContain("Shell command failed");
  });
});
