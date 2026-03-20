import { randomUUID } from "node:crypto";

import type { EventBus, EventPayloadByType, WorkEvent } from "@octopus/observability";

import { formatCompletionNotification } from "./formatter.js";
import type { GatewayClient } from "./gateway-client.js";
import type { PendingStore } from "./pending-store.js";
import type { PendingNotification, WebhookChatConfig } from "./types.js";

const DEFAULT_MAX_POLL_DURATION_MS = 30 * 60 * 1_000; // 30 minutes

export class NotificationListener {
  private readonly pollers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly pendingStore: PendingStore,
    private readonly chatConfig: WebhookChatConfig,
    private readonly eventBus?: EventBus
  ) {}

  async listen(sessionId: string, callbackUrl: string, channelId: string, goalDescription: string): Promise<void> {
    const pending: PendingNotification = {
      sessionId,
      callbackUrl,
      channelId,
      goalDescription,
      submittedAt: new Date().toISOString()
    };

    await this.pendingStore.save(pending);
    this.stop(sessionId);

    const maxDuration = this.chatConfig.maxPollDurationMs ?? DEFAULT_MAX_POLL_DURATION_MS;
    const deadline = Date.now() + maxDuration;

    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        this.stop(sessionId);
        this.emitChatEvent("chat.notification.failed", sessionId, {
          platform: "webhook",
          channelId: pending.channelId,
          sessionId: pending.sessionId,
          error: "Polling timed out"
        });
        return;
      }

      void this.tick(pending).catch((error) => {
        this.emitChatEvent("chat.notification.failed", pending.sessionId, {
          platform: "webhook",
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
        platform: "webhook",
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
    await this.gatewayClient.postCallback(pending.callbackUrl, payload);
    await this.pendingStore.remove(pending.sessionId);
    this.stop(pending.sessionId);
    this.emitChatEvent("chat.notification.sent", pending.sessionId, {
      platform: "webhook",
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
}
