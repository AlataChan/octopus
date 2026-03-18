import { describe, expect, it } from "vitest";

import { SchemaValidatorPlugin } from "../../verification/schema-validator.js";

describe("SchemaValidatorPlugin", () => {
  it("validates JSON output against a simple object schema", async () => {
    const plugin = new SchemaValidatorPlugin({
      targetPath: "report.json",
      schema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" }
        }
      },
      readFile: async () => JSON.stringify({ name: "octopus" })
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: ["report.json"]
    });

    expect(result.status).toBe("pass");
  });

  it("fails when required fields are missing", async () => {
    const plugin = new SchemaValidatorPlugin({
      targetPath: "report.json",
      schema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" }
        }
      },
      readFile: async () => JSON.stringify({ })
    });

    const result = await plugin.run({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
      goalId: "goal-1",
      workItemId: "item-1",
      artifactPaths: ["report.json"]
    });

    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.value).toContain("is required");
  });

  it("rejects target paths that escape the workspace", async () => {
    const plugin = new SchemaValidatorPlugin({
      targetPath: "../secret.json",
      schema: {
        type: "object"
      },
      readFile: async () => JSON.stringify({ ok: true })
    });

    await expect(
      plugin.run({
        workspaceRoot: "/workspace",
        sessionId: "session-1",
        goalId: "goal-1",
        workItemId: "item-1",
        artifactPaths: ["report.json"]
      })
    ).rejects.toThrow(/workspace/i);
  });
});
