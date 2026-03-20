import { randomUUID } from "node:crypto";

import type { EventBus, EventPayloadByType, WorkEvent } from "@octopus/observability";

import type { GatewayClient } from "./gateway-client.js";
import type { NotificationListener } from "./notification-listener.js";
import type { PendingStore } from "./pending-store.js";
import type { WebhookChatConfig } from "./types.js";

export interface WebhookGoalPayload {
  text?: string;
  callbackUrl?: string;
  channelId?: string;
}

export class WebhookAdapter {
  constructor(
    private readonly _config: WebhookChatConfig,
    private readonly gatewayClient: GatewayClient,
    private readonly _pendingStore: PendingStore,
    private readonly notificationListener: NotificationListener,
    private readonly eventBus?: EventBus
  ) {}

  async handleGoalSubmission(body: WebhookGoalPayload): Promise<{ text: string }> {
    const goalDescription = body.text?.trim() ?? "";
    if (goalDescription.length === 0) {
      return {
        text: "Goal description is required."
      };
    }

    const callbackUrl = body.callbackUrl?.trim();
    if (!callbackUrl) {
      return {
        text: "callbackUrl is required."
      };
    }

    this.emitChatEvent("chat.goal.received", body.channelId ?? "unknown", {
      platform: "webhook",
      channelId: body.channelId ?? "unknown",
      userId: "webhook",
      goalDescription
    });

    try {
      const sessionId = await this.processGoal(callbackUrl, body.channelId ?? "unknown", goalDescription);
      return {
        text: `Goal submitted. Session: ${sessionId}`
      };
    } catch (error) {
      this.emitChatFailure(body.channelId ?? "unknown", "pending", error);
      return {
        text: `Goal submission failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async processGoal(callbackUrl: string, channelId: string, goalDescription: string): Promise<string> {
    const submission = await this.gatewayClient.submitGoal(goalDescription);
    await this.notificationListener.listen(
      submission.sessionId,
      callbackUrl,
      channelId,
      goalDescription
    );
    return submission.sessionId;
  }

  private emitChatEvent<T extends "chat.goal.received">(
    type: T,
    key: string,
    payload: EventPayloadByType[T]
  ): void {
    if (!this.eventBus) {
      return;
    }

    this.eventBus.emit({
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: `chat-${key}`,
      goalId: `chat-${key}`,
      type,
      sourceLayer: "chat",
      payload
    } as Extract<WorkEvent, { type: T }>);
  }

  private emitChatFailure(channelId: string, sessionId: string, error: unknown): void {
    if (!this.eventBus) {
      return;
    }

    this.eventBus.emit({
      id: randomUUID(),
      timestamp: new Date(),
      sessionId,
      goalId: sessionId,
      type: "chat.notification.failed",
      sourceLayer: "chat",
      payload: {
        platform: "webhook",
        channelId,
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      }
    } as Extract<WorkEvent, { type: "chat.notification.failed" }>);
  }
}
