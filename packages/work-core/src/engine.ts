import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentRuntime, RuntimeResponse } from "@octopus/agent-runtime";
import type { ExecutionSubstratePort } from "@octopus/exec-substrate";
import type { EventBus, EventPayloadByType, WorkEvent, WorkEventType } from "@octopus/observability";
import type { SecurityPolicy } from "@octopus/security";
import type { StateStore } from "@octopus/state-store";
import { isCompletable, type Action, type Artifact, type SessionState, type Verification, type WorkGoal, type WorkItem, type WorkSession } from "@octopus/work-contracts";

export interface ExecuteGoalOptions {
  workspaceRoot?: string;
  maxIterations?: number;
}

export class WorkEngine {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly substrate: ExecutionSubstratePort,
    private readonly stateStore: StateStore,
    private readonly eventBus: EventBus,
    private readonly policy: SecurityPolicy
  ) {}

  async executeGoal(goal: WorkGoal, options: ExecuteGoalOptions = {}): Promise<WorkSession> {
    const session = await this.runtime.initSession(goal);
    if (session.items.length === 0) {
      session.items.push(createDefaultWorkItem(session, goal));
    }

    transitionSession(session, "active", "Goal accepted.");
    await this.writeVisibleState(goal, session, options.workspaceRoot, "Execute next action");
    await this.runtime.loadContext(session.id, {
      workspaceSummary: options.workspaceRoot,
      visibleFiles: options.workspaceRoot ? await listVisibleFiles(options.workspaceRoot) : [],
      plan: `Goal: ${goal.description}`,
      todo: "Execute next action",
      status: `Session state: ${session.state}`
    });
    await this.stateStore.saveSession(session);
    this.emit(session, "session.started", "work-core", { goalDescription: goal.description });

    const maxIterations = options.maxIterations ?? 20;
    for (let index = 0; index < maxIterations; index += 1) {
      const response = await this.runtime.requestNextAction(session.id);
      const currentItem = session.items.at(-1);
      if (!currentItem) {
        throw new Error("Work session has no active work item.");
      }

      if (response.kind === "action") {
        const blocked = await this.executeAction(session, currentItem, response.action, options.workspaceRoot);
        if (blocked) {
          return session;
        }
        continue;
      }

      if (response.kind === "completion") {
        return this.completeSession(session, response, options.workspaceRoot);
      }

      if (response.kind === "blocked") {
        transitionSession(session, "blocked", response.reason);
        await this.writeVisibleState(goal, session, options.workspaceRoot, "Await user input");
        await this.stateStore.saveSession(session);
        this.emit(session, "session.blocked", "work-core", { reason: response.reason });
        return session;
      }

      transitionSession(session, "blocked", response.question);
      await this.writeVisibleState(goal, session, options.workspaceRoot, "Clarification requested");
      await this.stateStore.saveSession(session);
      this.emit(session, "session.blocked", "work-core", { clarification: response.question });
      return session;
    }

    transitionSession(session, "blocked", "Maximum iterations reached.");
    await this.stateStore.saveSession(session);
    this.emit(session, "session.blocked", "work-core", { reason: "Maximum iterations reached." });
    return session;
  }

  private async executeAction(
    session: WorkSession,
    item: WorkItem,
    action: Action,
    workspaceRoot?: string
  ): Promise<boolean> {
    this.emit(session, "action.requested", "work-core", { actionId: action.id, actionType: action.type });

    const decision = this.policy.evaluate(action, mapActionTypeToCategory(action.type));
    if (!decision.allowed || decision.requiresConfirmation) {
      transitionSession(session, "blocked", decision.reason);
      await this.stateStore.saveSession(session);
      this.emit(session, "session.blocked", "work-core", {
        actionId: action.id,
        reason: decision.reason,
        riskLevel: decision.riskLevel
      });
      return true;
    }

    const result = await this.substrate.execute(action, {
      workspaceRoot: workspaceRoot ?? process.cwd(),
      sessionId: session.id,
      goalId: session.goalId,
      eventBus: this.eventBus
    });

    item.actions.push({
      ...action,
      result
    });
    item.verifications.push(createVerification(action, result));
    item.state = "active";
    session.updatedAt = new Date();

    await this.runtime.ingestToolResult(session.id, action.id, result);
    await this.stateStore.saveSession(session);
    this.emit(session, "action.completed", "work-core", {
      actionId: action.id,
      success: result.success
    });
    return false;
  }

  private async completeSession(
    session: WorkSession,
    response: Extract<RuntimeResponse, { kind: "completion" }>,
    workspaceRoot?: string
  ): Promise<WorkSession> {
    await this.writeVisibleState(
      {
        id: session.goalId,
        description: session.items[0]?.description ?? "Goal complete",
        constraints: [],
        successCriteria: [],
        createdAt: new Date()
      },
      session,
      workspaceRoot,
      "Goal complete"
    );

    const hasVerification = session.items.some((item) =>
      item.verifications.some((verification) => verification.passed)
    );
    const evidence = {
      targetArtifactExists: session.artifacts.length > 0,
      verificationRecorded: hasVerification,
      limitationsPersisted: session.artifacts.some((artifact) => artifact.path === "STATUS.md"),
      stateDurable: true
    };

    if (!isCompletable(evidence)) {
      transitionSession(session, "blocked", "Completion predicate failed.");
      await this.stateStore.saveSession(session);
      this.emit(session, "session.blocked", "work-core", { reason: "Completion predicate failed." });
      return session;
    }

    const currentItem = session.items.at(-1);
    if (currentItem) {
      currentItem.state = "done";
    }
    transitionSession(session, "completed", response.evidence);
    await this.stateStore.saveSession(session);
    this.emit(session, "session.completed", "work-core", { evidence: response.evidence });
    return session;
  }

  private async writeVisibleState(
    goal: WorkGoal,
    session: WorkSession,
    workspaceRoot: string | undefined,
    todoLine: string
  ): Promise<void> {
    if (!workspaceRoot) {
      return;
    }

    const plan = `# PLAN\n\nGoal: ${goal.description}\n`;
    const todo = `# TODO\n\n- ${todoLine}\n`;
    const status = `# STATUS\n\nSession: ${session.state}\nKnown limitations: none\n`;

    await Promise.all([
      writeFile(join(workspaceRoot, "PLAN.md"), plan, "utf8"),
      writeFile(join(workspaceRoot, "TODO.md"), todo, "utf8"),
      writeFile(join(workspaceRoot, "STATUS.md"), status, "utf8")
    ]);

    upsertArtifact(session, createArtifact("PLAN.md", "document", "Current plan"));
    upsertArtifact(session, createArtifact("TODO.md", "document", "Current todo"));
    upsertArtifact(session, createArtifact("STATUS.md", "document", "Current status"));
  }

  private emit<T extends WorkEventType>(
    session: WorkSession,
    type: T,
    sourceLayer: WorkEvent["sourceLayer"],
    payload: EventPayloadByType[T]
  ): void {
    const event = {
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: session.id,
      goalId: session.goalId,
      workItemId: session.items.at(-1)?.id,
      type,
      sourceLayer,
      payload
    } as Extract<WorkEvent, { type: T }>;

    this.eventBus.emit(event);
  }
}

function createDefaultWorkItem(session: WorkSession, goal: WorkGoal): WorkItem {
  return {
    id: randomUUID(),
    sessionId: session.id,
    description: goal.description,
    state: "active",
    observations: [],
    actions: [],
    verifications: [],
    createdAt: new Date()
  };
}

function createVerification(action: Action, result: ActionResultLike): Verification {
  return {
    id: randomUUID(),
    method: `action:${action.type}`,
    passed: result.success,
    evidence: result.output || result.error || "no output",
    createdAt: new Date()
  };
}

function createArtifact(path: string, type: Artifact["type"], description: string): Artifact {
  return {
    id: randomUUID(),
    type,
    path,
    description,
    createdAt: new Date()
  };
}

function upsertArtifact(session: WorkSession, artifact: Artifact): void {
  if (!session.artifacts.some((entry) => entry.path === artifact.path)) {
    session.artifacts.push(artifact);
  }
}

function transitionSession(session: WorkSession, state: SessionState, reason: string): void {
  const from = session.state;
  session.state = state;
  session.updatedAt = new Date();
  session.transitions.push({
    from,
    to: state,
    reason,
    triggerEvent: `session.${state}`,
    timestamp: new Date()
  });
}

function mapActionTypeToCategory(type: Action["type"]): "read" | "patch" | "shell" | "modelApiCall" {
  switch (type) {
    case "read":
    case "search":
      return "read";
    case "patch":
      return "patch";
    case "shell":
      return "shell";
    case "model-call":
      return "modelApiCall";
    default:
      return "read";
  }
}

async function listVisibleFiles(workspaceRoot: string): Promise<string[]> {
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

interface ActionResultLike {
  success: boolean;
  output: string;
  error?: string;
}
