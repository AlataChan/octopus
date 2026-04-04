import { isLoopback } from "./tls-guard.js";
import type { GatewayConfig } from "../types.js";

export function validateOrigin(
  origin: string | undefined,
  config: GatewayConfig,
  requestContext?: {
    protocol?: string;
    host?: string;
  }
): boolean {
  if (isLoopback(config.host)) {
    return true;
  }

  if (!origin) {
    return false;
  }

  if (config.allowedOrigins?.length) {
    return config.allowedOrigins.includes(origin);
  }

  const protocol = requestContext?.protocol ?? (config.tls ? "https" : "http");
  const host = requestContext?.host ?? `${config.host}:${config.port}`;
  const expectedOrigin = `${protocol}://${host}`;
  return origin === expectedOrigin;
}
