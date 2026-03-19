import { describe, expect, it, vi } from "vitest";

import { GatewayClient } from "../gateway-client.js";

describe("GatewayClient", () => {
  it("submits goals with a scoped bearer token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          token: "token-1",
          expiresAt: "2026-03-20T00:00:00.000Z"
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "session-1",
          goalId: "goal-1",
          state: "created"
        })
      );
    const client = new GatewayClient(
      {
        gatewayUrl: "https://octopus.example.com",
        gatewayApiKey: "gateway-secret"
      },
      fetchImpl
    );

    await client.connect();
    await client.submitGoal("Clean up temp directory");

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://octopus.example.com/auth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "gateway-secret"
        }),
        body: JSON.stringify({
          permissions: ["goals.submit", "sessions.read"]
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://octopus.example.com/api/goals",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1"
        })
      })
    );
  });

  it("refreshes the token and retries once after a 401", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          token: "token-1",
          expiresAt: "2026-03-20T00:00:00.000Z"
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(
        createJsonResponse({
          token: "token-2",
          expiresAt: "2026-03-20T00:05:00.000Z"
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          id: "session-1",
          state: "completed",
          artifacts: []
        })
      );
    const client = new GatewayClient(
      {
        gatewayUrl: "https://octopus.example.com",
        gatewayApiKey: "gateway-secret"
      },
      fetchImpl
    );

    await client.connect();
    const session = await client.getSession("session-1");

    expect(session.state).toBe("completed");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "https://octopus.example.com/api/sessions/session-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-2"
        })
      })
    );
  });
});

function createJsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}
