import { beforeEach, describe, expect, it } from "vitest";

import { SessionStorageAuthStore } from "../api/auth.js";

describe("SessionStorageAuthStore", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("persists the browser auth session in sessionStorage", () => {
    const store = new SessionStorageAuthStore();

    store.setSession({
      token: "token-1",
      expiresAt: "2026-04-02T10:00:00.000Z",
      role: "operator",
      username: "ops1"
    });

    const reloaded = new SessionStorageAuthStore();

    expect(reloaded.getSession()).toEqual({
      token: "token-1",
      expiresAt: "2026-04-02T10:00:00.000Z",
      role: "operator",
      username: "ops1"
    });
  });
});
