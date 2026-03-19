import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { verifySlackSignature } from "../slack/signature.js";

describe("verifySlackSignature", () => {
  it("accepts a valid v0 Slack signature", () => {
    const secret = "signing-secret";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const body = "token=a&text=clean+up";
    const signature = createSignature(secret, timestamp, body);

    expect(verifySlackSignature(secret, timestamp, body, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1_000));

    expect(verifySlackSignature("signing-secret", timestamp, "token=a", "v0=deadbeef")).toBe(false);
  });

  it("rejects expired timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));
    const secret = "signing-secret";
    const timestamp = String(Math.floor(new Date("2026-03-19T11:50:00.000Z").getTime() / 1_000));
    const body = "token=a";
    const signature = createSignature(secret, timestamp, body);

    expect(verifySlackSignature(secret, timestamp, body, signature)).toBe(false);
    vi.useRealTimers();
  });
});

function createSignature(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}
