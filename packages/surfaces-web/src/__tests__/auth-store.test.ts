import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionStorageAuthStore } from "../api/auth.js";

describe("SessionStorageAuthStore", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists the browser auth session in sessionStorage", () => {
    const store = new SessionStorageAuthStore();

    store.setSession({
      token: "token-1",
      expiresAt: "2027-04-02T10:00:00.000Z",
      role: "operator",
      username: "ops1"
    });

    const reloaded = new SessionStorageAuthStore();

    expect(reloaded.getSession()).toEqual({
      token: "token-1",
      expiresAt: "2027-04-02T10:00:00.000Z",
      role: "operator",
      username: "ops1"
    });
  });

  it("drops expired sessions from sessionStorage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T10:00:00.000Z"));

    window.sessionStorage.setItem("octopus.auth", JSON.stringify({
      token: "token-1",
      expiresAt: "2026-04-02T10:00:00.000Z",
      role: "operator",
      username: "ops1"
    }));

    const store = new SessionStorageAuthStore();

    expect(store.getSession()).toBeNull();
    expect(window.sessionStorage.getItem("octopus.auth")).toBeNull();
  });
});
