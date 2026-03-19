import { isLoopback } from "./tls-guard.js";
import type { GatewayConfig } from "../types.js";

export function validateOrigin(origin: string | undefined, config: GatewayConfig): boolean {
  if (isLoopback(config.host)) {
    return true;
  }

  if (!origin) {
    return false;
  }

  if (config.allowedOrigins?.length) {
    return config.allowedOrigins.includes(origin);
  }

  const protocol = config.tls ? "https" : "http";
  const expectedOrigin = `${protocol}://${config.host}:${config.port}`;
  return origin === expectedOrigin;
}
