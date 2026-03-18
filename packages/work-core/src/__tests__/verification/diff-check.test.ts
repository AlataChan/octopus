import { describe, expect, it } from "vitest";

import { DiffCheckPlugin } from "../../verification/diff-check.js";

describe("DiffCheckPlugin", () => {
  it("passes when file contents differ from baseline", async () => {
    const plugin = new DiffCheckPlugin({
      baseline: {
        "README.md": "before"
      },
      readFile: async () => "after"
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: ["README.md"]
    });

    expect(result.status).toBe("pass");
  });

  it("fails when no artifact content changed from the baseline", async () => {
    const plugin = new DiffCheckPlugin({
      baseline: {
        "README.md": "same"
      },
      readFile: async () => "same"
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: ["README.md"]
    });

    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.value).toContain("no differences");
  });

  it("rejects artifact paths that escape the workspace", async () => {
    const plugin = new DiffCheckPlugin({
      baseline: {
        "../secret.txt": "before"
      },
      readFile: async () => "after"
    });

    await expect(
      plugin.run({
        workspaceRoot: "/workspace",
        sessionId: "session-1",
        goalId: "goal-1",
        workItemId: "item-1",
        artifactPaths: ["../secret.txt"]
      })
    ).rejects.toThrow(/workspace/i);
  });
});
