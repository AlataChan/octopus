import type { FetchLike, GatewayClientConfig, GatewayGoalSubmission, GatewaySession, GatewayTokenResponse } from "./types.js";

export class GatewayClient {
  private readonly fetchImpl: FetchLike;
  private token?: string;

  constructor(
    private readonly config: GatewayClientConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = fetchImpl ?? defaultFetch;
  }

  async connect(): Promise<void> {
    const response = await this.fetchImpl(resolveUrl(this.config.gatewayUrl, "/auth/token"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.gatewayApiKey
      },
      body: JSON.stringify({
        permissions: ["goals.submit", "sessions.read"]
      })
    });

    if (!response.ok) {
      throw await buildHttpError(response, "Gateway token request failed");
    }

    const payload = await response.json() as GatewayTokenResponse;
    if (typeof payload.token !== "string" || payload.token.length === 0) {
      throw new Error("Gateway token response did not include a token.");
    }
    this.token = payload.token;
  }

  async submitGoal(description: string, constraints: string[] = []): Promise<GatewayGoalSubmission> {
    return this.requestJsonWithRetry<GatewayGoalSubmission>("POST", "/api/goals", {
      description,
      constraints
    });
  }

  async getSession(sessionId: string): Promise<GatewaySession> {
    return this.requestJsonWithRetry<GatewaySession>("GET", `/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  async postCallback(callbackUrl: string, payload: object): Promise<void> {
    const response = await this.fetchImpl(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw await buildHttpError(response, "Callback post failed");
    }
  }

  private async requestJsonWithRetry<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    allowRetry = true
  ): Promise<T> {
    if (!this.token) {
      await this.connect();
    }

    const response = await this.fetchImpl(resolveUrl(this.config.gatewayUrl, path), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    if (response.status === 401 && allowRetry) {
      await this.connect();
      return this.requestJsonWithRetry<T>(method, path, body, false);
    }

    if (!response.ok) {
      throw await buildHttpError(response, "Gateway request failed");
    }

    return response.json() as Promise<T>;
  }
}

export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

function resolveUrl(baseUrl: string, path: string): string {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function buildHttpError(response: { status: number; json(): Promise<unknown>; text(): Promise<string> }, fallback: string) {
  let payload: { error?: string } | string | null;
  try {
    payload = await response.json() as { error?: string } | string | null;
  } catch {
    const text = await response.text().catch(() => "");
    payload = text.length > 0 ? { error: text } : null;
  }

  if (typeof payload === "string") {
    return new HttpStatusError(response.status, payload);
  }

  return new HttpStatusError(response.status, payload?.error ?? `${fallback} (${response.status})`);
}

const defaultFetch: FetchLike = async (url, init) => {
  return fetch(url, init) as Promise<import("./types.js").FetchResponseLike>;
};
