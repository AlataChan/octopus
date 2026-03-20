import { describe, expect, it, vi } from "vitest";

import { WebhookAdapter } from "../webhook-adapter.js";

describe("WebhookAdapter", () => {
  it("rejects goal submissions without a callback URL", async () => {
    const gatewayClient = {
      submitGoal: vi.fn(),
      postCallback: vi.fn()
    };
    const notificationListener = {
      listen: vi.fn()
    };
    const adapter = new WebhookAdapter(
      {
        signingSecret: "secret",
        gatewayUrl: "https://gateway.example.com",
        gatewayApiKey: "gateway-secret",
        listenPort: 3000
      },
      gatewayClient as never,
      {} as never,
      notificationListener as never
    );

    const payload = await adapter.handleGoalSubmission({
      text: "Clean up temp directory"
    });

    expect(payload).toEqual({
      text: "callbackUrl is required."
    });
    expect(gatewayClient.submitGoal).not.toHaveBeenCalled();
    expect(notificationListener.listen).not.toHaveBeenCalled();
  });

  it("returns a failure message when goal submission fails", async () => {
    const gatewayClient = {
      submitGoal: vi.fn(async () => {
        throw new Error("Gateway unavailable");
      }),
      postCallback: vi.fn()
    };
    const notificationListener = {
      listen: vi.fn()
    };
    const adapter = new WebhookAdapter(
      {
        signingSecret: "secret",
        gatewayUrl: "https://gateway.example.com",
        gatewayApiKey: "gateway-secret",
        listenPort: 3000
      },
      gatewayClient as never,
      {} as never,
      notificationListener as never
    );

    const payload = await adapter.handleGoalSubmission({
      text: "Clean up temp directory",
      callbackUrl: "https://hooks.example.com/callback",
      channelId: "C123"
    });

    expect(payload).toEqual({
      text: "Goal submission failed: Gateway unavailable"
    });
    expect(notificationListener.listen).not.toHaveBeenCalled();
  });

  it("returns the created session ID after a successful submission", async () => {
    const gatewayClient = {
      submitGoal: vi.fn(async () => ({
        sessionId: "session-1",
        goalId: "goal-1",
        state: "created"
      })),
      postCallback: vi.fn()
    };
    const notificationListener = {
      listen: vi.fn(async () => {})
    };
    const adapter = new WebhookAdapter(
      {
        signingSecret: "secret",
        gatewayUrl: "https://gateway.example.com",
        gatewayApiKey: "gateway-secret",
        listenPort: 3000
      },
      gatewayClient as never,
      {} as never,
      notificationListener as never
    );

    const payload = await adapter.handleGoalSubmission({
      text: "Clean up temp directory",
      callbackUrl: "https://hooks.example.com/callback",
      channelId: "C123"
    });

    expect(payload).toEqual({
      text: "Goal submitted. Session: session-1"
    });
    expect(gatewayClient.submitGoal).toHaveBeenCalledWith("Clean up temp directory");
    expect(notificationListener.listen).toHaveBeenCalledWith(
      "session-1",
      "https://hooks.example.com/callback",
      "C123",
      "Clean up temp directory"
    );
    expect(gatewayClient.postCallback).not.toHaveBeenCalled();
  });
});
