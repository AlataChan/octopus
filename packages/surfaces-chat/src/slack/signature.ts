import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    return false;
  }

  const driftSeconds = Math.abs(Math.floor(Date.now() / 1_000) - seconds);
  if (driftSeconds > 300) {
    return false;
  }

  const expected = Buffer.from(
    `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
    "utf8"
  );
  const provided = Buffer.from(signature, "utf8");

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}
