import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";

import { verifySlackSignature } from "./slack/signature.js";
import { SlackAdapter } from "./slack/adapter.js";
import type { SlackConfig } from "./types.js";

export class ChatServer {
  private server?: HttpServer;

  constructor(
    private readonly config: SlackConfig,
    private readonly adapter: SlackAdapter
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.config.listenPort, this.config.listenHost ?? "0.0.0.0", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST" || req.url !== "/slack/commands") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const rawBody = await readRawBody(req);
    const timestamp = readHeader(req, "x-slack-request-timestamp");
    const signature = readHeader(req, "x-slack-signature");

    if (
      !timestamp ||
      !signature ||
      !verifySlackSignature(this.config.signingSecret, timestamp, rawBody, signature)
    ) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Invalid Slack signature" }));
      return;
    }

    const body = Object.fromEntries(new URLSearchParams(rawBody).entries());
    const payload = await this.adapter.handleSlashCommand(body);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}
