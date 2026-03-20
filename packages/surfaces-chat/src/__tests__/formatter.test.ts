import { describe, expect, it } from "vitest";

import { formatCompletionNotification } from "../formatter.js";

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

    expect(payload.text).toBe("Goal Complete");
    expect(payload.sessionId).toBe("session-1");
    expect(payload.state).toBe("completed");
    expect(payload.goalDescription).toBe("Clean up temp directory");
    expect(payload.artifactCount).toBe(2);
    expect(payload.duration).toBe("1m 0s");
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

    expect(payload.text).toBe("Goal Failed");
    expect(payload.state).toBe("failed");
    expect(payload.error).toBe("Shell command failed");
  });
});
