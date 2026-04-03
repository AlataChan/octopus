import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayClient } from "../api/client.js";
import { MemoryAuthStore } from "../api/auth.js";

describe("GatewayClient setup APIs", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const authStore = new MemoryAuthStore();

  beforeEach(() => {
    fetchMock.mockReset();
    authStore.clear();
    authStore.setSession({
      token: "browser-token",
      expiresAt: "2026-04-03T12:00:00.000Z",
      role: "admin",
      username: "ops-admin"
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads setup status without sending the browser authorization token", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        initialized: false,
        workspaceWritable: true
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const client = new GatewayClient("http://127.0.0.1:4321", authStore);

    await expect(client.getSetupStatus()).resolves.toEqual({
      initialized: false,
      workspaceWritable: true
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4321/api/setup/status", {
      method: "GET",
      headers: {}
    });
  });

  it("validates the setup token with the X-Setup-Token header only", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const client = new GatewayClient("http://127.0.0.1:4321", authStore);

    await expect(client.validateSetupToken("setup-token-1")).resolves.toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4321/api/setup/validate-token", {
      method: "POST",
      headers: {
        "X-Setup-Token": "setup-token-1"
      }
    });
  });

  it("submits the initialization payload with the setup token and no browser session", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ initialized: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const client = new GatewayClient("http://127.0.0.1:4321", authStore);

    await expect(client.initialize("setup-token-1", {
      runtime: {
        provider: "openai-compatible",
        model: "gpt-4.1-mini",
        apiKey: "sk-test",
        baseUrl: "https://example.test/v1"
      },
      admin: {
        username: "ops-admin",
        password: "super-secret"
      },
      additionalUsers: [
        {
          username: "viewer-1",
          password: "viewer-secret",
          role: "viewer"
        }
      ]
    })).resolves.toEqual({ initialized: true });

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4321/api/setup/initialize", {
      method: "POST",
      headers: {
        "X-Setup-Token": "setup-token-1",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        runtime: {
          provider: "openai-compatible",
          model: "gpt-4.1-mini",
          apiKey: "sk-test",
          baseUrl: "https://example.test/v1"
        },
        admin: {
          username: "ops-admin",
          password: "super-secret"
        },
        additionalUsers: [
          {
            username: "viewer-1",
            password: "viewer-secret",
            role: "viewer"
          }
        ]
      })
    });
  });
});
