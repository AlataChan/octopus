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

    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.config.apiKey}`
      },
      body: JSON.stringify({
        model: input.config.model,
        max_tokens: input.config.maxTokens,
        temperature: input.config.temperature,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const body = await readResponseBody(response);
    const telemetry = createTelemetry(response, endpoint, startedAt, body);
    if (!response.ok) {
      const message = createProviderErrorMessage(response.status, body);
      throw new ModelTurnError(message, {
        ...telemetry,
        success: false,
        error: message
      });
    }
    const text = extractResponseText(body);
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
}

export function resolveEndpoint(config: EmbeddedRuntimeConfig): string {
  const baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
  return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function createTelemetry(
  response: Response,
  endpoint: string,
  startedAt: number,
  body: any
): ModelTelemetry {
  return {
    endpoint,
    durationMs: Date.now() - startedAt,
    requestId: response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? undefined,
    statusCode: response.status,
    success: response.ok,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens
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

function extractResponseText(body: any): string {
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI-compatible response did not include message content.");
  }
  return content;
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
