import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { WorkSession } from "@octopus/work-contracts";
import { EvalRunner } from "../runner.js";
import type { EvalCase, EvalRunnerDeps } from "../types.js";

function makeCompletedSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: "session-1",
    goalId: "goal-1",
    workspaceId: "default",
    configProfileId: "default",
    state: "completed",
    items: [],
    observations: [],
    artifacts: [{ id: "a1", type: "document", path: "STATUS.md", description: "status", createdAt: new Date() }],
    transitions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDeps(session: WorkSession = makeCompletedSession()): EvalRunnerDeps {
  return {
    createApp: vi.fn(async () => ({
      engine: {
        executeGoal: vi.fn(async () => session),
      },
      flushTraces: vi.fn(async () => {}),
    })),
  };
}

const simpleCase: EvalCase = {
  id: "test-1",
  description: "Simple test",
  goal: { description: "Do something" },
  assertions: [{ type: "session-completed" }],
};

describe("EvalRunner", () => {
  it("runs a passing eval case", async () => {
    const runner = new EvalRunner(makeDeps());
    const result = await runner.runCase(simpleCase);
    expect(result.passed).toBe(true);
    expect(result.caseId).toBe("test-1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runs a failing eval case when session is blocked", async () => {
    const runner = new EvalRunner(makeDeps(makeCompletedSession({ state: "blocked" })));
    const result = await runner.runCase(simpleCase);
    expect(result.passed).toBe(false);
  });

  it("writes fixture files to temp workspace", async () => {
    let capturedWorkspaceRoot = "";
    const deps: EvalRunnerDeps = {
      createApp: vi.fn(async ({ workspaceRoot }) => {
        capturedWorkspaceRoot = workspaceRoot;
        // Verify fixture was written
        const content = await readFile(join(workspaceRoot, "input.txt"), "utf8");
        expect(content).toBe("hello world");
        return {
          engine: { executeGoal: vi.fn(async () => makeCompletedSession()) },
          flushTraces: vi.fn(async () => {}),
        };
      }),
    };

    const evalCase: EvalCase = {
      id: "fixture-test",
      description: "Fixture test",
      goal: { description: "Read file" },
      fixture: { files: { "input.txt": "hello world" } },
      assertions: [{ type: "session-completed" }],
    };

    const runner = new EvalRunner(deps);
    const result = await runner.runCase(evalCase);
    expect(result.passed).toBe(true);
    // Verify cleanup
    expect(existsSync(capturedWorkspaceRoot)).toBe(false);
  });

  it("handles engine errors gracefully", async () => {
    const deps: EvalRunnerDeps = {
      createApp: vi.fn(async () => ({
        engine: { executeGoal: vi.fn(async () => { throw new Error("Model API failed"); }) },
        flushTraces: vi.fn(async () => {}),
      })),
    };
    const runner = new EvalRunner(deps);
    const result = await runner.runCase(simpleCase);
    expect(result.passed).toBe(false);
    expect(result.error).toBe("Model API failed");
  });

  it("runs a suite sequentially", async () => {
    const runner = new EvalRunner(makeDeps());
    const results = await runner.runSuite([simpleCase, { ...simpleCase, id: "test-2" }]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
