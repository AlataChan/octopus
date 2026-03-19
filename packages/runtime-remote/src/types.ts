export interface RemoteRuntimeConfig {
  gatewayUrl: string;
  apiKey?: string;
  sessionToken?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}
