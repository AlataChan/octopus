import { describe, expect, it } from "vitest";
import { EventBus } from "@octopus/observability";
import { createWorkGoal } from "@octopus/work-contracts";
import { WorkEngine } from "../engine.js";
import {
  allowAllPolicy,
  blockingShellPolicy,
  createAction,
  FakeRuntime,
  FakeSubstrate,
  MemoryStateStore
} from "./helpers.js";

describe("blockSession writes blockedReason", () => {
  it("writes clarification kind when runtime returns clarification", async () => {
    const runtime = new FakeRuntime([
      { kind: "clarification", question: "Which dir?" }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "test" }));

    expect(session.state).toBe("blocked");
    expect(session.blockedReason?.kind).toBe("clarification-required");
    expect(session.blockedReason?.question).toBe("Which dir?");
  });

  it("writes approval-required kind with fingerprint when policy requiresConfirmation", async () => {
    const runtime = new FakeRuntime([
      { kind: "action", action: createAction("shell", { executable: "rm", args: ["-rf", "/tmp/test"] }) }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      blockingShellPolicy()
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "test" }));

    expect(session.state).toBe("blocked");
    expect(session.blockedReason?.kind).toBe("approval-required");
    expect(session.blockedReason?.approval).toBeDefined();
    expect(session.blockedReason?.approval?.actionType).toBe("shell");
    expect(session.blockedReason?.approval?.fingerprint).toMatch(/^shell:/);
    expect(session.blockedReason?.riskLevel).toBe("consequential");
  });
});

describe("computeApprovalKey determinism", () => {
  it("produces same fingerprint for same action type + params", async () => {
    // Use two sessions with blockingShellPolicy and same action
    const action = createAction("shell", { executable: "git", args: ["status"] });
    const runtime1 = new FakeRuntime([{ kind: "action", action }]);
    const runtime2 = new FakeRuntime([{ kind: "action", action: { ...action, id: "different-id", createdAt: new Date("2099-01-01") } }]);
    const store1 = new MemoryStateStore();
    const store2 = new MemoryStateStore();

    const engine1 = new WorkEngine(runtime1, new FakeSubstrate({ success: true, output: "ok" }), store1, new EventBus(), blockingShellPolicy());
    const engine2 = new WorkEngine(runtime2, new FakeSubstrate({ success: true, output: "ok" }), store2, new EventBus(), blockingShellPolicy());

    const session1 = await engine1.executeGoal(createWorkGoal({ description: "test1" }));
    const session2 = await engine2.executeGoal(createWorkGoal({ description: "test2" }));

    expect(session1.blockedReason?.approval?.fingerprint).toBe(session2.blockedReason?.approval?.fingerprint);
  });
});

describe("resumeBlockedSession", () => {
  it("throws if session is not blocked", async () => {
    const store = new MemoryStateStore();
    const runtime = new FakeRuntime([{ kind: "completion", evidence: "done" }]);
    const engine = new WorkEngine(runtime, new FakeSubstrate({ success: true, output: "ok" }), store, new EventBus(), allowAllPolicy());

    // Create a completed session
    const session = await engine.executeGoal(createWorkGoal({ description: "test" }));

    await expect(engine.resumeBlockedSession(session.id, { kind: "operator" }))
      .rejects.toThrow("is not blocked");
  });

  it("throws if session does not exist", async () => {
    const engine = new WorkEngine(
      new FakeRuntime([]),
      new FakeSubstrate({ success: true, output: "ok" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy()
    );

    await expect(engine.resumeBlockedSession("nonexistent", { kind: "operator" }))
      .rejects.toThrow("Unknown session");
  });

  it("atomically transitions state before hydration", async () => {
    const store = new MemoryStateStore();
    // First: create a blocked session
    const blockRuntime = new FakeRuntime([
      { kind: "clarification", question: "Which dir?" }
    ]);
    const engine1 = new WorkEngine(
      blockRuntime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );
    const blockedSession = await engine1.executeGoal(createWorkGoal({ description: "test" }));
    expect(blockedSession.state).toBe("blocked");
    expect(blockedSession.blockedReason).toBeDefined();

    // Now resume it
    const resumeRuntime = new FakeRuntime([
      { kind: "completion", evidence: "resumed ok" }
    ]);
    const engine2 = new WorkEngine(
      resumeRuntime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      allowAllPolicy()
    );

    const resumed = await engine2.resumeBlockedSession(blockedSession.id, { kind: "clarification", answer: "use /tmp" });

    // Session should have been atomically transitioned
    // Check that the intermediate save cleared blockedReason
    const intermediateSave = store.saveHistory.find(
      (s) => s.id === blockedSession.id && s.state === "active" && s.blockedReason === undefined
    );
    expect(intermediateSave).toBeDefined();
  });

  it("registers approval fingerprint with policy on approve", async () => {
    const store = new MemoryStateStore();
    const approvedPatterns: string[] = [];
    const confirmPolicy = {
      evaluate() {
        return {
          allowed: true,
          requiresConfirmation: true,
          riskLevel: "consequential" as const,
          reason: "Needs approval"
        };
      },
      approveForSession(pattern: string) {
        approvedPatterns.push(pattern);
      }
    };

    // Block with approval-required
    const blockRuntime = new FakeRuntime([
      { kind: "action", action: createAction("shell", { executable: "deploy" }) }
    ]);
    const engine1 = new WorkEngine(
      blockRuntime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      confirmPolicy
    );
    const blocked = await engine1.executeGoal(createWorkGoal({ description: "deploy" }));
    expect(blocked.blockedReason?.approval?.fingerprint).toBeDefined();
    const expectedFingerprint = blocked.blockedReason!.approval!.fingerprint;

    // Resume with approval
    const resumeRuntime = new FakeRuntime([
      { kind: "completion", evidence: "deployed" }
    ]);
    const engine2 = new WorkEngine(
      resumeRuntime,
      new FakeSubstrate({ success: true, output: "ok" }),
      store,
      new EventBus(),
      confirmPolicy
    );

    await engine2.resumeBlockedSession(blocked.id, { kind: "approval", decision: "approve" });

    expect(approvedPatterns).toContain(expectedFingerprint);
  });
});
