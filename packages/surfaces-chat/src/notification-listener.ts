import { randomUUID } from "node:crypto";

import type { EventBus, EventPayloadByType, WorkEvent } from "@octopus/observability";

import { formatCompletionNotification } from "./slack/formatter.js";
import { HttpStatusError, type GatewayClient } from "./gateway-client.js";
import type { PendingStore } from "./pending-store.js";
import type { PendingNotification, SlackConfig } from "./types.js";

export class NotificationListener {
  private readonly pollers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly pendingStore: PendingStore,
    private readonly slackConfig: SlackConfig,
    private readonly eventBus?: EventBus
  ) {}

  listen(sessionId: string, responseUrl: string, channelId: string, goalDescription: string): void {
    const pending: PendingNotification = {
      sessionId,
      responseUrl,
      channelId,
      goalDescription,
      submittedAt: new Date().toISOString()
    };

    this.pendingStore.save(pending);
    this.stop(sessionId);
    const timer = setInterval(() => {
      void this.tick(pending).catch((error) => {
        this.emitChatEvent("chat.notification.failed", pending.sessionId, {
          platform: "slack",
          channelId: pending.channelId,
          sessionId: pending.sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, 10_000);
    timer.unref?.();
    this.pollers.set(sessionId, timer);
    void this.tick(pending).catch((error) => {
      this.emitChatEvent("chat.notification.failed", pending.sessionId, {
        platform: "slack",
        channelId: pending.channelId,
        sessionId: pending.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  stop(sessionId: string): void {
    const timer = this.pollers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.pollers.delete(sessionId);
    }
  }

  private async tick(pending: PendingNotification): Promise<void> {
    const session = await this.gatewayClient.getSession(pending.sessionId);
    if (session.state !== "completed" && session.state !== "failed") {
      return;
    }

    const payload = formatCompletionNotification(session, pending.goalDescription);
    try {
      await this.gatewayClient.postResponse(pending.responseUrl, payload);
    } catch (error) {
      if (!(error instanceof HttpStatusError) || (error.status !== 404 && error.status !== 410) || !this.slackConfig.botToken) {
        throw error;
      }
      await this.postFallbackMessage(pending.channelId, payload);
    }
    this.pendingStore.remove(pending.sessionId);
    this.stop(pending.sessionId);
    this.emitChatEvent("chat.notification.sent", pending.sessionId, {
      platform: "slack",
      channelId: pending.channelId,
      sessionId: pending.sessionId,
      notificationType: session.state === "completed" ? "completion" : "failure"
    });
  }

  private emitChatEvent<T extends "chat.notification.sent" | "chat.notification.failed">(
    type: T,
    sessionId: string,
    payload: EventPayloadByType[T]
  ): void {
    if (!this.eventBus) {
      return;
    }

    this.eventBus.emit({
      id: randomUUID(),
      timestamp: new Date(),
      sessionId,
      goalId: sessionId,
      type,
      sourceLayer: "chat",
      payload
    } as Extract<WorkEvent, { type: T }>);
  }

  private async postFallbackMessage(channelId: string, payload: { text: string; blocks: unknown[] }): Promise<void> {
    if (!this.slackConfig.botToken) {
      throw new Error("Slack bot token is required for fallback notifications.");
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.slackConfig.botToken}`
      },
      body: JSON.stringify({
        channel: channelId,
        text: payload.text,
        blocks: payload.blocks
      })
    });

    if (!response.ok) {
      throw new HttpStatusError(response.status, "Slack bot token fallback failed");
    }
  }
}
