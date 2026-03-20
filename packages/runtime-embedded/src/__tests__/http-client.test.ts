import { describe, expect, it, vi } from "vitest";

import type { RuntimeResponse } from "@octopus/agent-runtime";
import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { HttpModelClient } from "../http-client.js";

describe("HttpModelClient", () => {
  it("calls OpenAI-compatible endpoints and returns parsed runtime responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "{\"kind\":\"completion\",\"evidence\":\"done\"}"
              }
            }
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "request-id": "req-1"
          }
        }
      )
    );

    const client = new HttpModelClient(fetchMock as unknown as typeof fetch);
    const response = await client.completeTurn({
      session: createWorkSession(createWorkGoal({ description: "Read docs" })),
      results: [],
      config: {
        provider: "openai-compatible",
        model: "gpt-4o",
        apiKey: "test-key",
        maxTokens: 1_024,
        temperature: 0,
        allowModelApiCall: true
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((response.response as RuntimeResponse).kind).toBe("completion");
    expect(response.telemetry.requestId).toBe("req-1");
    expect(response.telemetry.inputTokens).toBe(20);
    expect(response.telemetry.outputTokens).toBe(10);
  });

  it("surfaces provider error details when the API responds with a failure status", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            message: "invalid api key"
          }
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
            "request-id": "req-2"
          }
        }
      )
    );

    const client = new HttpModelClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.completeTurn({
        session: createWorkSession(createWorkGoal({ description: "Read docs" })),
        results: [],
        config: {
          provider: "openai-compatible",
          model: "gpt-4o",
          apiKey: "bad-key",
          maxTokens: 1_024,
          temperature: 0,
          allowModelApiCall: true
        }
      })
    ).rejects.toThrow(/401.*invalid api key/i);
  });
});
