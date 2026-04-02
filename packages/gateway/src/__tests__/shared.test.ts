import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readJsonBody } from "../routes/shared.js";

describe("readJsonBody", () => {
  it("rejects payloads that exceed the configured byte limit", async () => {
    const req = Readable.from([Buffer.from('{"value":"1234567890"}')]) as never;

    await expect(readJsonBody(req, { maxBytes: 16 })).rejects.toMatchObject({
      statusCode: 413,
      message: "Request body is too large."
    });
  });
});
