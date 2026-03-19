export interface SlackConfig {
  signingSecret: string;
  botToken?: string;
  gatewayUrl: string;
  gatewayApiKey: string;
  listenPort: number;
  listenHost?: string;
  pendingStorePath?: string;
}

export interface ChatConfig {
  platform: "slack";
  slack?: SlackConfig;
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
  responseUrl: string;
  channelId: string;
  goalDescription: string;
  submittedAt: string;
}

export interface SlackTextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

export interface SlackBlock {
  type: "header" | "section";
  text: SlackTextObject;
}

export interface SlackBlocks {
  text: string;
  blocks: SlackBlock[];
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
