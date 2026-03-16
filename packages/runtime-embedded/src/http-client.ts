import type { RuntimeResponse } from "@octopus/agent-runtime";

import type { EmbeddedRuntimeConfig } from "./config.js";
import { ModelTurnError, type ModelClient, type ModelTelemetry, type ModelTurnResult } from "./runtime.js";
import { buildTurnPrompt } from "./prompt-builder.js";
import { parseRuntimeResponse } from "./response-parser.js";

export class HttpModelClient implements ModelClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async completeTurn(input: Parameters<ModelClient["completeTurn"]>[0]): Promise<ModelTurnResult> {
    const startedAt = Date.now();
    const endpoint = resolveEndpoint(input.config);
    const prompt = buildTurnPrompt({
      session: input.session,
      context: input.context,
      results: input.results
    });

    const response =
      input.config.provider === "anthropic"
        ? await this.fetchAnthropic(input.config, endpoint, prompt)
        : await this.fetchOpenAiCompatible(input.config, endpoint, prompt);

    const body = await readResponseBody(response);
    const telemetry = createTelemetry(response, endpoint, startedAt, body, input.config);
    if (!response.ok) {
      const message = createProviderErrorMessage(response.status, body);
      throw new ModelTurnError(message, {
        ...telemetry,
        success: false,
        error: message
      });
    }
    const text = extractResponseText(input.config, body);
    try {
      const parsed = parseRuntimeResponse(text);

      return {
        response: parsed,
        telemetry
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime response parsing failed.";
      throw new ModelTurnError(message, {
        ...telemetry,
        success: false,
        error: message
      });
    }
  }

  private fetchAnthropic(config: EmbeddedRuntimeConfig, endpoint: string, prompt: string): Promise<Response> {
    return this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: [{ role: "user", content: prompt }]
      })
    });
  }

  private fetchOpenAiCompatible(config: EmbeddedRuntimeConfig, endpoint: string, prompt: string): Promise<Response> {
    return this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: [{ role: "user", content: prompt }]
      })
    });
  }
}

function resolveEndpoint(config: EmbeddedRuntimeConfig): string {
  if (config.provider === "anthropic") {
    return config.baseUrl ?? "https://api.anthropic.com/v1/messages";
  }

  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function createTelemetry(
  response: Response,
  endpoint: string,
  startedAt: number,
  body: any,
  config: EmbeddedRuntimeConfig
): ModelTelemetry {
  return {
    endpoint,
    durationMs: Date.now() - startedAt,
    requestId: response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? undefined,
    statusCode: response.status,
    success: response.ok,
    ...extractUsage(config, body)
  };
}

async function readResponseBody(response: Response): Promise<any> {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return { rawText };
  }
}

function extractResponseText(config: EmbeddedRuntimeConfig, body: any): string {
  if (config.provider === "anthropic") {
    const textBlock = (body.content as Array<{ type: string; text?: string }>).find(
      (item) => item.type === "text" && typeof item.text === "string"
    );
    if (!textBlock?.text) {
      throw new Error("Anthropic response did not include a text block.");
    }
    return textBlock.text;
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI-compatible response did not include message content.");
  }
  return content;
}

function extractUsage(config: EmbeddedRuntimeConfig, body: any): Pick<ModelTelemetry, "inputTokens" | "outputTokens"> {
  if (config.provider === "anthropic") {
    return {
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens
    };
  }

  return {
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens
  };
}

function createProviderErrorMessage(statusCode: number, body: any): string {
  const detail =
    extractString(body?.error?.message) ??
    extractString(body?.error) ??
    extractString(body?.message) ??
    extractString(body?.detail) ??
    extractString(body?.rawText) ??
    "Unknown provider error.";

  return `Model API call failed with status ${statusCode}: ${detail}`;
}

function extractString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
