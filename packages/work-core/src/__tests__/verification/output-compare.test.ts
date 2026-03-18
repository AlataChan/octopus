import { describe, expect, it } from "vitest";

import { OutputComparePlugin } from "../../verification/output-compare.js";

describe("OutputComparePlugin", () => {
  it("passes when file contents match the expected output", async () => {
    const plugin = new OutputComparePlugin({
      targetPath: "STATUS.md",
      expectedOutput: "# STATUS\n",
      readFile: async () => "# STATUS\n"
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: ["STATUS.md"]
    });

    expect(result.status).toBe("pass");
  });

  it("fails when output differs from the expected fixture", async () => {
    const plugin = new OutputComparePlugin({
      targetPath: "STATUS.md",
      expectedOutput: "# STATUS\n",
      readFile: async () => "# TODO\n"
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: ["STATUS.md"]
    });

    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.value).toContain("differed");
  });

  it("rejects target paths that escape the workspace", async () => {
    const plugin = new OutputComparePlugin({
      targetPath: "../secret.txt",
      expectedOutput: "expected",
      readFile: async () => "actual"
    });

    await expect(
      plugin.run({
        workspaceRoot: "/workspace",
        sessionId: "session-1",
        goalId: "goal-1",
        workItemId: "item-1",
        artifactPaths: ["STATUS.md"]
      })
    ).rejects.toThrow(/workspace/i);
  });
});
