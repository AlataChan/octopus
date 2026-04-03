import * as crypto from "node:crypto";

import type { GatewayPermission, GatewayRole, GatewayUserAccount, OperatorContext } from "./types.js";

interface StoredToken {
  operatorId: string;
  role: GatewayRole;
  permissions: GatewayPermission[];
  expiresAt: Date;
}

const MAX_SCRYPT_N = 1_048_576;
const MAX_SCRYPT_R = 64;
const MAX_SCRYPT_P = 64;
const DUMMY_PASSWORD_HASH =
  "scrypt$16384$8$1$BwcHBwcHBwcHBwcHBwcHBw==$8yKqFT5uNVOuIgYOxeYhKv3arsebQYQC5628cZqMGqCdvOX9qsGu7P9Jep8RK4/RhV6J7TtGEXUn7ed0E6GxfA==";

const ROLE_PERMISSIONS: Record<GatewayRole, GatewayPermission[]> = {
  viewer: [
    "sessions.list",
    "sessions.read",
    "config.read"
  ],
  operator: [
    "sessions.list",
    "sessions.read",
    "config.read",
    "goals.submit",
    "sessions.control",
    "sessions.approve"
  ],
  admin: [
    "sessions.list",
    "sessions.read",
    "config.read",
    "goals.submit",
    "sessions.control",
    "sessions.approve",
    "runtime.proxy"
  ]
};

export class TokenStore {
  private readonly tokens = new Map<string, StoredToken>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(private readonly tokenTtlMs = 3_600_000) {}

  mintToken(
    operatorId: string,
    permissions: GatewayPermission[],
    role: GatewayRole = "operator"
  ): { token: string; expiresAt: Date } {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.tokenTtlMs);
    this.tokens.set(token, {
      operatorId,
      role,
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
      role: entry.role,
      permissions: [...entry.permissions],
      authMethod: "session-token"
    };
  }

  revokeToken(token: string): void {
    this.tokens.delete(token);
  }

  clear(): void {
    this.tokens.clear();
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

export function getPermissionsForRole(role: GatewayRole): GatewayPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export async function createPasswordHash(password: string, salt?: Buffer): Promise<string> {
  const actualSalt = salt ?? crypto.randomBytes(16);
  const derivedKey = await deriveScryptKey(password, actualSalt, 64, {
    N: 16_384,
    r: 8,
    p: 1
  });
  return `scrypt$16384$8$1$${actualSalt.toString("base64")}$${derivedKey.toString("base64")}`;
}

export async function verifyPasswordHash(password: string, passwordHash: string): Promise<boolean> {
  const parsed = parseScryptHash(passwordHash);
  if (!parsed) {
    return false;
  }

  const derivedKey = await deriveScryptKey(password, parsed.salt, parsed.expected.length, parsed.options);
  return cryptoHelpers.constantTimeDigestEqual(derivedKey, parsed.expected);
}

export const authHelpers = {
  verifyPasswordHash(password: string, passwordHash: string): Promise<boolean> {
    return verifyPasswordHash(password, passwordHash);
  }
};

export async function authenticateUser(
  users: GatewayUserAccount[] | undefined,
  username: string,
  password: string
): Promise<GatewayUserAccount | null> {
  const account = users?.find((candidate) => candidate.username === username);
  const passwordHash = account?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const verified = await authHelpers.verifyPasswordHash(password, passwordHash);

  return verified && account ? account : null;
}

function digestSecret(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function parseScryptHash(passwordHash: string): {
  salt: Buffer;
  expected: Buffer;
  options: {
    N: number;
    r: number;
    p: number;
  };
} | null {
  const parts = passwordHash.split("$");
  if (parts[0] !== "scrypt") {
    return null;
  }

  if (parts.length === 6) {
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = decodeBase64(parts[4]);
    const expected = decodeBase64(parts[5]);
    if (
      !Number.isInteger(N)
      || !Number.isInteger(r)
      || !Number.isInteger(p)
      || N <= 1
      || r <= 0
      || p <= 0
      || N > MAX_SCRYPT_N
      || r > MAX_SCRYPT_R
      || p > MAX_SCRYPT_P
      || !salt
      || !expected
    ) {
      return null;
    }
    return {
      salt,
      expected,
      options: {
        N,
        r,
        p
      }
    };
  }

  if (parts.length === 3) {
    const salt = decodeBase64(parts[1]);
    const expected = decodeBase64(parts[2]);
    if (!salt || !expected) {
      return null;
    }
    return {
      salt,
      expected,
      options: {
        N: 16_384,
        r: 8,
        p: 1
      }
    };
  }

  return null;
}

function decodeBase64(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

function deriveScryptKey(
  secret: string,
  salt: Buffer,
  keyLength: number,
  options: {
    N: number;
    r: number;
    p: number;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey as Buffer);
    });
  });
}

export const cryptoHelpers = {
  constantTimeDigestEqual(left: Buffer, right: Buffer): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return crypto.timingSafeEqual(left, right);
  }
};
