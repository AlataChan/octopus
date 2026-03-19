import { describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import type { Action } from "@octopus/work-contracts";

import { ExecutionSubstrate } from "../substrate.js";
import type { ActionHandler } from "../types.js";

describe("ExecutionSubstrate extensions", () => {
  it("delegates unknown action types to registered extensions", async () => {
    const handler: ActionHandler = async (_action, _context) => ({
      success: true,
      output: "mcp result"
    });
    const substrate = new ExecutionSubstrate(new Map([["mcp-call", handler]]));

    const result = await substrate.execute(
      createAction("mcp-call", {
        serverId: "filesystem",
        toolName: "read_file",
        arguments: { path: "README.md" }
      }),
      {
        workspaceRoot: process.cwd(),
        sessionId: "session-1",
        goalId: "goal-1",
        eventBus: new EventBus()
      }
    );

    expect(result).toEqual({
      success: true,
      output: "mcp result"
    });
  });

  it("rejects extensions that try to override built-in action types", () => {
    expect(
      () =>
        new ExecutionSubstrate(
          new Map<Action["type"], ActionHandler>([["read", async () => ({ success: true, output: "nope" })]])
        )
    ).toThrow(/Cannot override built-in action type: read/);
  });
});

function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return {
    id: `action-${type}`,
    type,
    params,
    createdAt: new Date()
  };
}
