export interface AuthStore {
  getToken(): string | null;
  setToken(token: string): void;
  clear(): void;
}

export class MemoryAuthStore implements AuthStore {
  private token: string | null = null;

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  clear(): void {
    this.token = null;
  }
}
