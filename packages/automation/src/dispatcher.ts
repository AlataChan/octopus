import { randomUUID } from "node:crypto";

import { createWorkGoal, type WorkSession } from "@octopus/work-contracts";
import type { EventBus, WorkEvent } from "@octopus/observability";
import type { StateStore } from "@octopus/state-store";
import type { ExecuteGoalOptions, WorkEngine } from "@octopus/work-core";

import type { AutomationEvent, NamedGoalRegistry } from "./types.js";

export interface AutomationDispatcherOptions {
  workspaceRoot?: string;
}

export class AutomationDispatcher {
  constructor(
    private readonly stateStore: StateStore,
    private readonly engine: Pick<WorkEngine, "executeGoal">,
    private readonly goalRegistry: NamedGoalRegistry,
    private readonly eventBus: EventBus,
    private readonly options: AutomationDispatcherOptions = {}
  ) {}

  async dispatch(event: AutomationEvent): Promise<void> {
    const goalDef = this.goalRegistry[event.namedGoalId];
    if (!goalDef) {
      this.emit(event, "automation.source.failed", undefined, {
        sourceType: event.sourceType,
        namedGoalId: event.namedGoalId,
        error: `Unknown namedGoalId: ${event.namedGoalId}`
      });
      return;
    }

    const sessions = await this.stateStore.listSessions();
    const match = sessions
      .filter((session) => session.namedGoalId === event.namedGoalId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    const goal = createWorkGoal({
      ...goalDef,
      namedGoalId: event.namedGoalId
    });

    if (match?.state === "active") {
      this.emit(event, "event.injected", match, {
        namedGoalId: event.namedGoalId,
        sessionId: match.id,
        action: "skipped"
      });
      // Keep automation.triggered even when dedupe skips execution so the trace still shows
      // that the source fired and why no new/resumed session followed.
      this.emit(event, "automation.triggered", match, {
        sourceType: event.sourceType,
        namedGoalId: event.namedGoalId,
        payload: event.payload
      });
      return;
    }

    const executeOptions: ExecuteGoalOptions = {
      workspaceRoot: this.options.workspaceRoot
    };

    let session: WorkSession;
    if (match && (match.state === "blocked" || match.state === "verifying")) {
      session = await this.engine.executeGoal(goal, {
        ...executeOptions,
        resumeFrom: { sessionId: match.id }
      });
      this.emit(event, "event.injected", session, {
        namedGoalId: event.namedGoalId,
        sessionId: session.id,
        action: "resumed"
      });
    } else {
      session = await this.engine.executeGoal(goal, executeOptions);
      this.emit(event, "event.injected", session, {
        namedGoalId: event.namedGoalId,
        sessionId: session.id,
        action: "created"
      });
    }

    this.emit(event, "automation.triggered", session, {
      sourceType: event.sourceType,
      namedGoalId: event.namedGoalId,
      payload: event.payload
    });
  }

  private emit<T extends "automation.source.failed" | "automation.triggered" | "event.injected">(
    automationEvent: AutomationEvent,
    type: T,
    session: Pick<WorkSession, "id" | "goalId"> | Pick<import("@octopus/work-contracts").SessionSummary, "id" | "goalId"> | undefined,
    payload: Extract<WorkEvent, { type: T }>["payload"]
  ): void {
    this.eventBus.emit({
      id: randomUUID(),
      timestamp: automationEvent.triggeredAt,
      sessionId: session?.id ?? `automation:${automationEvent.namedGoalId}`,
      goalId: session?.goalId ?? `automation:${automationEvent.namedGoalId}`,
      type,
      sourceLayer: "automation",
      payload
    } as Extract<WorkEvent, { type: T }>);
  }
}
