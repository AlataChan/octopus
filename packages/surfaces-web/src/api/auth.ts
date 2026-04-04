export type AuthRole = "viewer" | "operator" | "admin";

export interface AuthSession {
  token: string;
  expiresAt: string;
  role: AuthRole;
  username: string;
}

export interface AuthStore {
  getSession(): AuthSession | null;
  setSession(session: AuthSession): void;
  clear(): void;
}

const sessionStorageKey = "octopus.auth";

export class SessionStorageAuthStore implements AuthStore {
  getSession(): AuthSession | null {
    if (!isSessionStorageAvailable()) {
      return null;
    }

    const raw = window.sessionStorage.getItem(sessionStorageKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AuthSession>;
      if (
        typeof parsed.token === "string"
        && typeof parsed.expiresAt === "string"
        && typeof parsed.username === "string"
        && (parsed.role === "viewer" || parsed.role === "operator" || parsed.role === "admin")
      ) {
        const expiresAt = Date.parse(parsed.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          window.sessionStorage.removeItem(sessionStorageKey);
          return null;
        }

        return {
          token: parsed.token,
          expiresAt: parsed.expiresAt,
          role: parsed.role,
          username: parsed.username
        };
      }
    } catch {
      window.sessionStorage.removeItem(sessionStorageKey);
    }

    return null;
  }

  setSession(session: AuthSession): void {
    if (!isSessionStorageAvailable()) {
      return;
    }

    window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
  }

  clear(): void {
    if (!isSessionStorageAvailable()) {
      return;
    }

    window.sessionStorage.removeItem(sessionStorageKey);
  }
}

export class MemoryAuthStore implements AuthStore {
  private session: AuthSession | null = null;

  getSession(): AuthSession | null {
    return this.session;
  }

  setSession(session: AuthSession): void {
    this.session = session;
  }

  clear(): void {
    this.session = null;
  }
}

function isSessionStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}
