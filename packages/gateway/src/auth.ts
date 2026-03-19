import * as crypto from "node:crypto";

import type { GatewayPermission, OperatorContext } from "./types.js";

interface StoredToken {
  operatorId: string;
  permissions: GatewayPermission[];
  expiresAt: Date;
}

export class TokenStore {
  private readonly tokens = new Map<string, StoredToken>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(private readonly tokenTtlMs = 3_600_000) {}

  mintToken(
    operatorId: string,
    permissions: GatewayPermission[]
  ): { token: string; expiresAt: Date } {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.tokenTtlMs);
    this.tokens.set(token, {
      operatorId,
      permissions: [...permissions],
      expiresAt
    });

    return { token, expiresAt };
  }

  validateToken(token: string): OperatorContext | null {
    const entry = this.tokens.get(token);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt.getTime() <= Date.now()) {
      this.tokens.delete(token);
      return null;
    }

    return {
      operatorId: entry.operatorId,
      permissions: [...entry.permissions],
      authMethod: "session-token"
    };
  }

  revokeToken(token: string): void {
    this.tokens.delete(token);
  }

  startSweep(intervalMs: number): void {
    this.stopSweep();
    this.sweepTimer = setInterval(() => {
      this.removeExpiredTokens();
    }, intervalMs);
    this.sweepTimer.unref?.();
  }

  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  private removeExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens.entries()) {
      if (entry.expiresAt.getTime() <= now) {
        this.tokens.delete(token);
      }
    }
  }
}

export function validateApiKey(candidate: string, configured: string): boolean {
  const left = digestSecret(candidate);
  const right = digestSecret(configured);
  return cryptoHelpers.constantTimeDigestEqual(left, right);
}

function digestSecret(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export const cryptoHelpers = {
  constantTimeDigestEqual(left: Buffer, right: Buffer): boolean {
    return crypto.timingSafeEqual(left, right);
  }
};
