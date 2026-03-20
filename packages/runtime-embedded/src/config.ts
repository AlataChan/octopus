export interface EmbeddedRuntimeConfig {
  provider: "openai-compatible";
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  baseUrl?: string;
  allowModelApiCall: boolean;
}

