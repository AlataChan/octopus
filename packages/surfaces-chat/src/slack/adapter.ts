import { randomUUID } from "node:crypto";

import type { EventBus, EventPayloadByType, WorkEvent } from "@octopus/observability";

import type { GatewayClient } from "../gateway-client.js";
import type { NotificationListener } from "../notification-listener.js";
import type { PendingStore } from "../pending-store.js";
import type { SlackConfig } from "../types.js";

export class SlackAdapter {
  constructor(
    private readonly _config: SlackConfig,
    private readonly gatewayClient: GatewayClient,
    private readonly _pendingStore: PendingStore,
    private readonly notificationListener: NotificationListener,
    private readonly eventBus?: EventBus
  ) {}

  async handleSlashCommand(body: Record<string, string>): Promise<{ text: string }> {
    const goalDescription = body.text?.trim() ?? "";
    if (goalDescription.length === 0) {
      return {
        text: "Goal description is required."
      };
    }

    this.emitChatEvent("chat.goal.received", body.channel_id ?? "unknown", {
      platform: "slack",
      channelId: body.channel_id ?? "unknown",
      userId: body.user_id ?? "unknown",
      goalDescription
    });

    void this.processGoal(body, goalDescription);
    return {
      text: "Goal received. Submitting now."
    };
  }

  private async processGoal(body: Record<string, string>, goalDescription: string): Promise<void> {
    const responseUrl = body.response_url;
    if (!responseUrl) {
      return;
    }

    try {
      const submission = await this.gatewayClient.submitGoal(goalDescription);
      this.notificationListener.listen(
        submission.sessionId,
        responseUrl,
        body.channel_id ?? "unknown",
        goalDescription
      );
      await this.gatewayClient.postResponse(responseUrl, {
        text: `Goal submitted. Session: ${submission.sessionId}`
      });
    } catch (error) {
      await this.gatewayClient.postResponse(responseUrl, {
        text: `Goal submission failed: ${error instanceof Error ? error.message : String(error)}`
      });
      this.emitChatFailure(body.channel_id ?? "unknown", "pending", error);
    }
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
        platform: "slack",
        channelId,
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      }
    } as Extract<WorkEvent, { type: "chat.notification.failed" }>);
  }
}
