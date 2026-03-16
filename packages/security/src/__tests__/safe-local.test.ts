import { describe, expect, it } from "vitest";

import type { Action } from "@octopus/work-contracts";

import { SafeLocalPolicy } from "../safe-local.js";

function createAction(type: Action["type"], params: Record<string, unknown>): Action {
  return {
    id: "action-1",
    type,
    params,
    createdAt: new Date()
  };
}

describe("SafeLocalPolicy", () => {
  it("allows read and patch inside safe-local", () => {
    const policy = new SafeLocalPolicy({ allowModelApiCall: false });

    expect(policy.evaluate(createAction("read", { path: "README.md" }), "read").allowed).toBe(true);
    expect(policy.evaluate(createAction("patch", { path: "README.md" }), "patch").allowed).toBe(true);
  });

  it("requires confirmation for consequential shell commands", () => {
    const policy = new SafeLocalPolicy({ allowModelApiCall: false });

    const decision = policy.evaluate(
      createAction("shell", { executable: "git", args: ["status", "/tmp/other"] }),
      "shell"
    );

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.riskLevel).toBe("consequential");
  });

  it("allows approved shell commands without re-prompting", () => {
    const policy = new SafeLocalPolicy({ allowModelApiCall: false });
    policy.approveForSession("shell:git status");

    const decision = policy.evaluate(
      createAction("shell", { executable: "git", args: ["status"] }),
      "shell"
    );

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it("denies general network but allows configured model api calls", () => {
    const policy = new SafeLocalPolicy({ allowModelApiCall: true });

    expect(policy.evaluate(createAction("model-call", {}), "modelApiCall").allowed).toBe(true);
    expect(policy.evaluate(createAction("model-call", {}), "network").allowed).toBe(false);
  });
});
