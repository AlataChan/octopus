import type { Action, ActionResult } from "@octopus/work-contracts";
import type { EventBus } from "@octopus/observability";

export interface SubstrateContext {
  workspaceRoot: string;
  sessionId: string;
  goalId: string;
  eventBus: EventBus;
}

export type ToolResult = ActionResult;

export type ActionHandler = (action: Action, context: SubstrateContext) => Promise<ToolResult>;

export interface ExecutionSubstratePort {
  execute(action: Action, context: SubstrateContext): Promise<ToolResult>;
}
