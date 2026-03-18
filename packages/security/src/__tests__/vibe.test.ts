import { describe, expect, it } from "vitest";

import type { Action } from "@octopus/work-contracts";

import { VibePolicy } from "../vibe.js";

function createAction(type: Action["type"], params: Record<string, unknown> = {}): Action {
  return {
    id: `${type}-1`,
    type,
    params,
    createdAt: new Date("2026-03-18T00:00:00.000Z")
  };
}

describe("VibePolicy", () => {
  it("allows read, patch, shell, and network categories without confirmation", () => {
    const policy = new VibePolicy({ allowModelApiCall: true });

    expect(policy.evaluate(createAction("read", { path: "README.md" }), "read")).toMatchObject({
      allowed: true,
      requiresConfirmation: false
    });
    expect(policy.evaluate(createAction("patch", { path: "README.md" }), "patch")).toMatchObject({
      allowed: true,
      requiresConfirmation: false
    });
    expect(policy.evaluate(createAction("shell", { executable: "git", args: ["status"] }), "shell")).toMatchObject({
      allowed: true,
      requiresConfirmation: false
    });
    expect(policy.evaluate(createAction("model-call"), "network")).toMatchObject({
      allowed: true,
      requiresConfirmation: false
    });
  });

  it("denies remote attach and unconfigured model API calls", () => {
    const policy = new VibePolicy({ allowModelApiCall: false });

    expect(policy.evaluate(createAction("model-call"), "remote").allowed).toBe(false);
    expect(policy.evaluate(createAction("model-call"), "modelApiCall").allowed).toBe(false);
  });
});
