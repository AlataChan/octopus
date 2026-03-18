import { describe, expect, it } from "vitest";

import type { Action } from "@octopus/work-contracts";

import { PlatformPolicy } from "../platform.js";

function createAction(type: Action["type"], params: Record<string, unknown> = {}): Action {
  return {
    id: `${type}-1`,
    type,
    params,
    createdAt: new Date("2026-03-18T00:00:00.000Z")
  };
}

describe("PlatformPolicy", () => {
  it("respects the executable allowlist and network/remote flags", () => {
    const policy = new PlatformPolicy(
      {
        schemaVersion: 1,
        allowedExecutables: ["git", "pnpm"],
        allowNetwork: true,
        allowRemote: false
      },
      { allowModelApiCall: true }
    );

    expect(policy.evaluate(createAction("read", { path: "README.md" }), "read").allowed).toBe(true);
    expect(policy.evaluate(createAction("patch", { path: "README.md" }), "patch").allowed).toBe(true);
    expect(policy.evaluate(createAction("shell", { executable: "git", args: ["status"] }), "shell")).toMatchObject({
      allowed: true,
      requiresConfirmation: false
    });
    expect(policy.evaluate(createAction("shell", { executable: "node", args: ["script.js"] }), "shell").allowed).toBe(false);
    expect(policy.evaluate(createAction("model-call"), "network").allowed).toBe(true);
    expect(policy.evaluate(createAction("model-call"), "remote").allowed).toBe(false);
    expect(policy.evaluate(createAction("model-call"), "modelApiCall").allowed).toBe(true);
  });

  it("default-denies shell, network, and remote when no policy file grants them", () => {
    const policy = new PlatformPolicy(
      {
        schemaVersion: 1
      },
      { allowModelApiCall: false }
    );

    expect(policy.evaluate(createAction("shell", { executable: "git", args: ["status"] }), "shell").allowed).toBe(false);
    expect(policy.evaluate(createAction("model-call"), "network").allowed).toBe(false);
    expect(policy.evaluate(createAction("model-call"), "remote").allowed).toBe(false);
    expect(policy.evaluate(createAction("model-call"), "modelApiCall").allowed).toBe(false);
  });
});
