import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "@octopus/observability";
import { createWorkGoal } from "@octopus/work-contracts";

import { WorkEngine } from "../engine.js";
import type { VerificationPlugin } from "../verification/plugin.js";
import { allowAllPolicy, FakeRuntime, FakeSubstrate, MemoryStateStore } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WorkEngine verification integration", () => {
  it("blocks completion when a verification plugin returns partial without override", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-verification-"));
    tempDirs.push(workspaceRoot);
    const partialPlugin: VerificationPlugin = {
      method: "manual",
      async run() {
        return {
          id: "verification-1",
          method: "manual",
          status: "partial",
          score: 0.8,
          evidence: [{ label: "tests", value: "8/10", passed: false }],
          durationMs: 1,
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        };
      }
    };

    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: {
          id: "action-1",
          type: "patch",
          params: { path: "README.md", content: "done" },
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        }
      },
      { kind: "completion", evidence: "done" }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "README updated" }),
      store,
      new EventBus(),
      allowAllPolicy(),
      { verificationPlugins: [partialPlugin] }
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Verify with partial" }), {
      workspaceRoot
    });

    expect(session.state).toBe("blocked");
    expect(session.transitions.at(-1)?.reason).toBe("Completion predicate failed.");
  });

  it("allows completion when partial override is explicitly granted", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-verification-"));
    tempDirs.push(workspaceRoot);
    const partialPlugin: VerificationPlugin = {
      method: "manual",
      async run() {
        return {
          id: "verification-1",
          method: "manual",
          status: "partial",
          score: 0.8,
          evidence: [{ label: "tests", value: "8/10", passed: false }],
          durationMs: 1,
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        };
      }
    };

    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: {
          id: "action-1",
          type: "patch",
          params: { path: "README.md", content: "done" },
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        }
      },
      { kind: "completion", evidence: "done" }
    ]);
    const store = new MemoryStateStore();
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "README updated" }),
      store,
      new EventBus(),
      allowAllPolicy(),
      { verificationPlugins: [partialPlugin] }
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Verify with override" }), {
      workspaceRoot,
      partialOverrideGranted: true
    });

    expect(session.state).toBe("completed");
  });

  it("requires every verification plugin to pass before completion", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-verification-"));
    tempDirs.push(workspaceRoot);
    const passPlugin: VerificationPlugin = {
      method: "manual",
      async run() {
        return {
          id: "verification-pass",
          method: "manual",
          status: "pass",
          score: 1,
          evidence: [{ label: "suite", value: "green", passed: true }],
          durationMs: 1,
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        };
      }
    };
    const failPlugin: VerificationPlugin = {
      method: "diff-check",
      async run() {
        return {
          id: "verification-fail",
          method: "diff-check",
          status: "fail",
          score: 0,
          evidence: [{ label: "diff", value: "unexpected changes", passed: false }],
          durationMs: 1,
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        };
      }
    };

    const runtime = new FakeRuntime([
      {
        kind: "action",
        action: {
          id: "action-1",
          type: "patch",
          params: { path: "README.md", content: "done" },
          createdAt: new Date("2026-03-18T00:00:00.000Z")
        }
      },
      { kind: "completion", evidence: "done" }
    ]);
    const engine = new WorkEngine(
      runtime,
      new FakeSubstrate({ success: true, output: "README updated" }),
      new MemoryStateStore(),
      new EventBus(),
      allowAllPolicy(),
      { verificationPlugins: [passPlugin, failPlugin] }
    );

    const session = await engine.executeGoal(createWorkGoal({ description: "Every plugin must pass" }), {
      workspaceRoot
    });

    expect(session.state).toBe("blocked");
    expect(session.transitions.at(-1)?.reason).toBe("Completion predicate failed.");
  });
});
