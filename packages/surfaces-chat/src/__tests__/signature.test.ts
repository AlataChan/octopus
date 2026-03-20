import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { verifyWebhookSignature } from "../signature.js";

describe("verifyWebhookSignature", () => {
  it("accepts a valid HMAC signature", () => {
    const secret = "signing-secret";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const body = '{"text":"clean up"}';
    const signature = createSignature(secret, timestamp, body);

    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1_000));

    expect(verifyWebhookSignature("signing-secret", timestamp, '{"text":"a"}', "deadbeef")).toBe(false);
  });

  it("rejects expired timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));
    const secret = "signing-secret";
    const timestamp = String(Math.floor(new Date("2026-03-19T11:50:00.000Z").getTime() / 1_000));
    const body = '{"text":"a"}';
    const signature = createSignature(secret, timestamp, body);

    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(false);
    vi.useRealTimers();
  });
});

function createSignature(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}:${body}`).digest("hex");
}
