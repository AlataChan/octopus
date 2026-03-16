export interface EmbeddedRuntimeConfig {
  provider: "anthropic" | "openai-compatible";
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  baseUrl?: string;
  allowModelApiCall: boolean;
}

