import type { IncomingMessage } from "node:http";

import type { GatewayConfig } from "../types.js";

export function isLoopback(host: string | undefined): boolean {
  if (!host) {
    return false;
  }

  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "::ffff:127.0.0.1";
}

export function isInCIDRRange(ip: string | undefined, cidrs: string[]): boolean {
  const target = parseIpv4(ip);
  if (target === null) {
    return false;
  }

  return cidrs.some((cidr) => {
    const [network, prefixRaw] = cidr.split("/");
    const parsedNetwork = parseIpv4(network);
    const prefix = Number(prefixRaw);
    if (parsedNetwork === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return false;
    }

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (target & mask) === (parsedNetwork & mask);
  });
}

export function isSecureConnection(req: IncomingMessage, config: GatewayConfig): boolean {
  const socket = req.socket as typeof req.socket & { encrypted?: boolean };
  if (socket.encrypted) {
    return true;
  }

  if (isLoopback(socket.remoteAddress)) {
    return true;
  }

  if (config.trustProxyCIDRs?.length && isInCIDRRange(socket.remoteAddress, config.trustProxyCIDRs)) {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    return protocol === "https";
  }

  return false;
}

function parseIpv4(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  const octets = normalized.split(".");
  if (octets.length !== 4) {
    return null;
  }

  let result = 0;
  for (const octet of octets) {
    const parsed = Number(octet);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return null;
    }
    result = (result << 8) | parsed;
  }

  return result >>> 0;
}
