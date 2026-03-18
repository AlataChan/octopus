import { describe, expect, it } from "vitest";

import { TestRunnerPlugin } from "../../verification/test-runner.js";

describe("TestRunnerPlugin", () => {
  it("returns pass when the configured command succeeds", async () => {
    const plugin = new TestRunnerPlugin({
      executable: "pnpm",
      args: ["test"],
      runner: async () => ({
        exitCode: 0,
        stdout: "42/42 tests passed",
        stderr: "",
        durationMs: 12
      })
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: []
    });

    expect(result.status).toBe("pass");
    expect(result.evidence[0]?.value).toContain("42/42");
  });

  it("passes a filtered environment to the command runner", async () => {
    const originalSecret = process.env.OCTOPUS_SECRET_TEST;
    const originalPath = process.env.PATH;
    process.env.OCTOPUS_SECRET_TEST = "top-secret";
    process.env.PATH = "/usr/bin";

    let capturedEnv: NodeJS.ProcessEnv | undefined;

    try {
      const plugin = new TestRunnerPlugin({
        executable: "pnpm",
        args: ["test"],
        runner: async (input) => {
          capturedEnv = input.env;
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 1
          };
        }
      });

      await plugin.run({
        workspaceRoot: "/workspace",
        sessionId: "session-1",
        goalId: "goal-1",
        workItemId: "item-1",
        artifactPaths: []
      });

      expect(capturedEnv?.PATH).toBe("/usr/bin");
      expect(capturedEnv?.OCTOPUS_SECRET_TEST).toBeUndefined();
    } finally {
      if (originalSecret === undefined) {
        delete process.env.OCTOPUS_SECRET_TEST;
      } else {
        process.env.OCTOPUS_SECRET_TEST = originalSecret;
      }
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it("returns fail when the configured command exits non-zero", async () => {
    const plugin = new TestRunnerPlugin({
      executable: "pnpm",
      args: ["test"],
      runner: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "1 test failed",
        durationMs: 12
      })
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: []
    });

    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.value).toContain("1 test failed");
  });
});
