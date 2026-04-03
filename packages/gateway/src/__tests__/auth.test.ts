import type { IncomingMessage } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as authModule from "../auth.js";
import {
  authenticateUser,
  createPasswordHash,
  getPermissionsForRole,
  TokenStore,
  validateApiKey,
  verifyPasswordHash
} from "../auth.js";
import { authenticateRequest, extractCredentials, requirePermission } from "../middleware/auth-middleware.js";
import { validateOrigin } from "../middleware/origin-guard.js";
import { isInCIDRRange, isLoopback, isSecureConnection } from "../middleware/tls-guard.js";
import type { GatewayAuthConfig } from "../types.js";

describe("gateway auth foundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates API keys with constant-time comparison", () => {
    const spy = vi.spyOn(authModule.cryptoHelpers, "constantTimeDigestEqual");

    expect(validateApiKey("top-secret", "top-secret")).toBe(true);
    expect(validateApiKey("wrong-secret", "top-secret")).toBe(false);
    expect(validateApiKey("short", "top-secret")).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it("mints tokens with expiry metadata", () => {
    const store = new TokenStore(1_000);

    const result = store.mintToken("operator-1", ["sessions.read"]);

    expect(result.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("validates tokens and rejects expired or unknown entries", async () => {
    const store = new TokenStore(5);
    const { token } = store.mintToken("operator-1", ["sessions.control"]);

    expect(store.validateToken(token)).toEqual({
      operatorId: "operator-1",
      role: "operator",
      permissions: ["sessions.control"],
      authMethod: "session-token"
    });
    expect(store.validateToken("missing")).toBeNull();

    await sleep(10);

    expect(store.validateToken(token)).toBeNull();
  });

  it("revokes tokens", () => {
    const store = new TokenStore(1_000);
    const { token } = store.mintToken("operator-1", ["config.read"]);

    store.revokeToken(token);

    expect(store.validateToken(token)).toBeNull();
  });

  it("derives role-specific permissions", () => {
    expect(getPermissionsForRole("viewer")).toEqual([
      "sessions.list",
      "sessions.read",
      "config.read"
    ]);
    expect(getPermissionsForRole("operator")).toEqual([
      "sessions.list",
      "sessions.read",
      "config.read",
      "goals.submit",
      "sessions.control",
      "sessions.approve"
    ]);
    expect(getPermissionsForRole("admin")).toEqual([
      "sessions.list",
      "sessions.read",
      "config.read",
      "goals.submit",
      "sessions.control",
      "sessions.approve",
      "runtime.proxy"
    ]);
  });

  it("creates and verifies scrypt password hashes", async () => {
    const passwordHash = await createPasswordHash("octopus-ops");

    await expect(verifyPasswordHash("octopus-ops", passwordHash)).resolves.toBe(true);
    await expect(verifyPasswordHash("wrong-password", passwordHash)).resolves.toBe(false);
  });

  it("still performs scrypt work for unknown usernames", async () => {
    const passwordHash = await createPasswordHash("octopus-ops");
    const verifySpy = vi.spyOn(authModule.authHelpers, "verifyPasswordHash");

    await expect(
      authenticateUser(
        [
          {
            username: "ops1",
            passwordHash,
            role: "operator"
          }
        ],
        "missing-user",
        "wrong-password"
      )
    ).resolves.toBeNull();

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith("wrong-password", expect.any(String));
  });

  it("rejects unreasonable scrypt parameters before invoking the hasher", async () => {
    const invalidHash = "scrypt$1048577$8$1$BwcHBwcHBwcHBwcHBwcHBw==$AQID";

    await expect(verifyPasswordHash("octopus-ops", invalidHash)).resolves.toBe(false);
  });

  it("sweeps expired tokens", async () => {
    const store = new TokenStore(5);
    const { token } = store.mintToken("operator-1", ["sessions.list"]);

    store.startSweep(1);
    await sleep(15);
    store.stopSweep();

    expect(store.validateToken(token)).toBeNull();
    const tokens = Reflect.get(store as object, "tokens") as Map<string, unknown>;
    expect(tokens.size).toBe(0);
  });

  it("extracts credentials from request headers", () => {
    expect(
      extractCredentials(
        createRequest({
          "x-api-key": "secret"
        })
      )
    ).toEqual({
      type: "api-key",
      key: "secret"
    });

    expect(
      extractCredentials(
        createRequest({
          authorization: "Bearer token-1"
        })
      )
    ).toEqual({
      type: "bearer",
      token: "token-1"
    });

    expect(extractCredentials(createRequest({}))).toBeNull();
  });

  it("authenticates requests and checks permissions", () => {
    const tokenStore = new TokenStore(1_000);
    const { token } = tokenStore.mintToken("operator-2", ["sessions.approve"]);
    const config: GatewayAuthConfig = {
      apiKey: "secret",
      defaultPermissions: ["sessions.list", "config.read"]
    };

    const apiKeyOperator = authenticateRequest(createRequest({ "x-api-key": "secret" }), config, tokenStore);
    const tokenOperator = authenticateRequest(createRequest({ authorization: `Bearer ${token}` }), config, tokenStore);

    expect(apiKeyOperator).toEqual({
      operatorId: "operator",
      role: "admin",
      permissions: ["sessions.list", "config.read"],
      authMethod: "api-key"
    });
    expect(tokenOperator?.operatorId).toBe("operator-2");
    expect(requirePermission(tokenOperator!, "sessions.approve")).toBe(true);
    expect(requirePermission(apiKeyOperator!, "sessions.approve")).toBe(false);
    expect(authenticateRequest(createRequest({ "x-api-key": "wrong" }), config, tokenStore)).toBeNull();
  });

  it("detects loopback hosts", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
  });

  it("checks CIDR range membership", () => {
    expect(isInCIDRRange("10.0.1.5", ["10.0.0.0/8"])).toBe(true);
    expect(isInCIDRRange("::ffff:172.16.0.1", ["172.16.0.0/16"])).toBe(true);
    expect(isInCIDRRange("192.168.1.5", ["10.0.0.0/8"])).toBe(false);
  });

  it("checks transport security rules", () => {
    const config = {
      port: 4321,
      host: "0.0.0.0",
      workspaceRoot: "/workspace",
      auth: {
        apiKey: "secret",
        defaultPermissions: []
      },
      trustProxyCIDRs: ["10.0.0.0/8"]
    };

    expect(
      isSecureConnection(
        createRequest(
          {},
          {
            encrypted: true,
            remoteAddress: "203.0.113.10"
          }
        ),
        config
      )
    ).toBe(true);
    expect(
      isSecureConnection(
        createRequest(
          {},
          {
            remoteAddress: "127.0.0.1"
          }
        ),
        config
      )
    ).toBe(true);
    expect(
      isSecureConnection(
        createRequest(
          {},
          {
            remoteAddress: "10.0.1.10"
          }
        ),
        config
      )
    ).toBe(false);
    expect(
      isSecureConnection(
        createRequest(
          {
            "x-forwarded-proto": "http"
          },
          {
            remoteAddress: "10.0.1.10"
          }
        ),
        {
          ...config,
          allowInsecureTrustedProxy: true
        }
      )
    ).toBe(true);
    expect(
      isSecureConnection(
        createRequest(
          {
            "x-forwarded-proto": "https"
          },
          {
            remoteAddress: "10.0.1.10"
          }
        ),
        config
      )
    ).toBe(true);
    expect(
      isSecureConnection(
        createRequest(
          {
            "x-forwarded-proto": "https"
          },
          {
            remoteAddress: "203.0.113.10"
          }
        ),
        config
      )
    ).toBe(false);
  });

  it("validates browser origins", () => {
    expect(
      validateOrigin("https://octopus.example.com:4321", {
        port: 4321,
        host: "octopus.example.com",
        workspaceRoot: "/workspace",
        tls: {
          cert: "cert.pem",
          key: "key.pem"
        },
        auth: {
          apiKey: "secret",
          defaultPermissions: []
        }
      })
    ).toBe(true);

    expect(
      validateOrigin("https://console.example.com", {
        port: 4321,
        host: "octopus.example.com",
        workspaceRoot: "/workspace",
        auth: {
          apiKey: "secret",
          defaultPermissions: []
        },
        allowedOrigins: ["https://console.example.com"]
      })
    ).toBe(true);

    expect(
      validateOrigin(undefined, {
        port: 4321,
        host: "octopus.example.com",
        workspaceRoot: "/workspace",
        auth: {
          apiKey: "secret",
          defaultPermissions: []
        }
      })
    ).toBe(false);
  });
});

function createRequest(
  headers: Record<string, string>,
  socketOverrides: Partial<IncomingMessage["socket"]> & { encrypted?: boolean } = {}
): IncomingMessage {
  return {
    headers,
    socket: {
      remoteAddress: socketOverrides.remoteAddress,
      encrypted: socketOverrides.encrypted,
      ...socketOverrides
    }
  } as unknown as IncomingMessage;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
