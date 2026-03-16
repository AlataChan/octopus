import { describe, expect, it } from "vitest";

import { createLocalWorkEngine } from "../factory.js";

describe("createLocalWorkEngine", () => {
  it("wires the phase 1 local engine from concrete adapters", () => {
    const app = createLocalWorkEngine({
      workspaceRoot: process.cwd(),
      dataDir: `${process.cwd()}/.octopus`,
      runtime: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      },
      modelClient: {
        async completeTurn() {
          return {
            response: { kind: "completion", evidence: "done" },
            telemetry: {
              endpoint: "https://api.anthropic.com/v1/messages",
              durationMs: 10,
              success: true
            }
          };
        }
      }
    });

    expect(typeof app.engine.executeGoal).toBe("function");
    expect(typeof app.runtime.requestNextAction).toBe("function");
    expect(typeof app.store.saveSession).toBe("function");
  });
});

