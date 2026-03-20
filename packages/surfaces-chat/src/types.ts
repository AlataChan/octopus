export interface WebhookChatConfig {
  signingSecret: string;
  gatewayUrl: string;
  gatewayApiKey: string;
  listenPort: number;
  listenHost?: string;
  pendingStorePath?: string;
  maxPollDurationMs?: number;
}

export interface ChatConfig {
  platform: "webhook";
  webhook?: WebhookChatConfig;
}

export type ChatNotificationType = "ack" | "completion" | "failure";

export interface ChatNotification {
  platform: string;
  channelId: string;
  sessionId: string;
  type: ChatNotificationType;
  summary: string;
}

export interface PendingNotification {
  sessionId: string;
  callbackUrl: string;
  channelId: string;
  goalDescription: string;
  submittedAt: string;
}

export interface NotificationPayload {
  text: string;
  sessionId: string;
  state: "completed" | "failed";
  goalDescription: string;
  artifactCount: number;
  duration: string;
  error?: string;
}

export interface GatewayClientConfig {
  gatewayUrl: string;
  gatewayApiKey: string;
}

export interface GatewayTokenResponse {
  token: string;
  expiresAt: string;
}

export interface GatewayGoalSubmission {
  sessionId: string;
  goalId: string;
  state: string;
}

export interface GatewaySessionArtifact {
  id?: string;
  path?: string;
  description?: string;
  type?: string;
}

export interface GatewaySession {
  id: string;
  goalId?: string;
  state: string;
  createdAt?: string;
  updatedAt?: string;
  artifacts?: GatewaySessionArtifact[];
  error?: string;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<FetchResponseLike>;
