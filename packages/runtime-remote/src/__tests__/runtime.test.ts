import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeResponse } from "@octopus/agent-runtime";
import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { RemoteRuntime } from "../runtime.js";
import type { WsClient } from "../ws-client.js";

describe("RemoteRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects by sending auth and waiting for auth.ok", async () => {
    const wsClient = new FakeWsClient();
    const runtime = new RemoteRuntime(
      {
        gatewayUrl: "wss://octopus.example.com/ws/runtime",
        apiKey: "secret"
      },
      wsClient
    );

    const connectPromise = runtime.connect();
    await flushAsync();

    expect(wsClient.connectCalls).toEqual(["wss://octopus.example.com/ws/runtime"]);
    expect(wsClient.sentMessages).toEqual([
      {
        type: "auth",
        apiKey: "secret"
      }
    ]);

    wsClient.pushMessage({ type: "auth.ok" });
    await expect(connectPromise).resolves.toBeUndefined();
  });

  it("proxies initSession and returns the session from the matching requestId result", async () => {
    const wsClient = new FakeWsClient();
    const runtime = await connectRuntime(wsClient);
    const goal = createWorkGoal({
      id: "goal-1",
      description: "Run remotely"
    });
    const session = createWorkSession(goal, {
      id: "session-1"
    });

    const sessionPromise = runtime.initSession(goal);

    const sent = wsClient.sentMessages.at(-1) as {
      type: string;
      requestId: string;
      goal: typeof goal;
    };
    expect(sent.type).toBe("runtime.initSession");
    expect(sent.goal).toEqual({
      ...goal,
      createdAt: goal.createdAt.toISOString()
    });

    wsClient.pushMessage({
      type: "runtime.initSession.result",
      requestId: sent.requestId,
      session
    });

    await expect(sessionPromise).resolves.toEqual(session);
  });

  it("proxies pauseSession and resolves on the matching result message", async () => {
    const wsClient = new FakeWsClient();
    const runtime = await connectRuntime(wsClient);

    const pausePromise = runtime.pauseSession("session-1");

    const sent = wsClient.sentMessages.at(-1) as {
      type: string;
      requestId: string;
      sessionId: string;
    };
    expect(sent).toMatchObject({
      type: "runtime.pauseSession",
      sessionId: "session-1"
    });

    wsClient.pushMessage({
      type: "runtime.pauseSession.result",
      requestId: sent.requestId
    });

    await expect(pausePromise).resolves.toBeUndefined();
  });

  it("returns runtime responses from requestNextAction", async () => {
    const wsClient = new FakeWsClient();
    const runtime = await connectRuntime(wsClient);
    const response: RuntimeResponse = {
      kind: "blocked",
      reason: "Need confirmation"
    };

    const responsePromise = runtime.requestNextAction("session-1");

    const sent = wsClient.sentMessages.at(-1) as {
      type: string;
      requestId: string;
    };
    wsClient.pushMessage({
      type: "runtime.requestNextAction.result",
      requestId: sent.requestId,
      response
    });

    await expect(responsePromise).resolves.toEqual(response);
  });

  it("sends signalCompletion as fire-and-forget without requestId", async () => {
    const wsClient = new FakeWsClient();
    const runtime = await connectRuntime(wsClient);

    runtime.signalCompletion("session-1", { evidence: "All done" });

    expect(wsClient.sentMessages.at(-1)).toEqual({
      type: "runtime.signalCompletion",
      sessionId: "session-1",
      candidate: {
        evidence: "All done"
      }
    });
  });

  it("rejects pending requests when they exceed the request timeout", async () => {
    vi.useFakeTimers();
    const wsClient = new FakeWsClient();
    const runtime = await connectRuntime(wsClient, {
      requestTimeoutMs: 10
    });

    const pausePromise = runtime.pauseSession("session-1");
    const rejection = expect(pausePromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(11);

    await rejection;
  });

  it("rejects pending requests when the gateway sends runtime.error", async () => {
    const wsClient = new FakeWsClient();
    const runtime = await connectRuntime(wsClient);

    const metadataPromise = runtime.getMetadata("session-1");
    const sent = wsClient.sentMessages.at(-1) as {
      requestId: string;
    };

    wsClient.pushMessage({
      type: "runtime.error",
      requestId: sent.requestId,
      error: "Gateway rejected the request"
    });

    await expect(metadataPromise).rejects.toThrow("Gateway rejected the request");
  });
});

async function connectRuntime(
  wsClient: FakeWsClient,
  configOverrides: Partial<ConstructorParameters<typeof RemoteRuntime>[0]> = {}
): Promise<RemoteRuntime> {
  const runtime = new RemoteRuntime(
    {
      gatewayUrl: "wss://octopus.example.com/ws/runtime",
      apiKey: "secret",
      connectTimeoutMs: 1_000,
      requestTimeoutMs: 50,
      ...configOverrides
    },
    wsClient
    );

    const connectPromise = runtime.connect();
    await flushAsync();
    wsClient.pushMessage({ type: "auth.ok" });
    await connectPromise;
    wsClient.sentMessages.length = 0;
    return runtime;
  }

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeWsClient implements WsClient {
  readonly connectCalls: string[] = [];
  readonly sentMessages: unknown[] = [];
  isConnected = false;
  private handler?: (data: string) => void;

  async connect(url: string): Promise<void> {
    this.connectCalls.push(url);
    this.isConnected = true;
  }

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data));
  }

  onMessage(handler: (data: string) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.isConnected = false;
  }

  pushMessage(payload: unknown): void {
    this.handler?.(JSON.stringify(payload));
  }
}
