import WebSocket, { type RawData } from "ws";

export interface WsClient {
  readonly isConnected: boolean;
  connect(url: string): Promise<void>;
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose?(handler: () => void): void;
  close(): void | Promise<void>;
}

export class RuntimeWsClient implements WsClient {
  private socket?: WebSocket;
  private readonly messageHandlers = new Set<(data: string) => void>();
  private readonly closeHandlers = new Set<() => void>();

  constructor(private readonly connectTimeoutMs = 10_000) {}

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(url: string): Promise<void> {
    if (this.isConnected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        socket.terminate();
        reject(new Error("Remote runtime WebSocket connection timed out."));
      }, this.connectTimeoutMs);
      timeout.unref?.();

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("open", handleOpen);
        socket.off("error", handleError);
        socket.off("close", handleCloseBeforeOpen);
      };

      const handleOpen = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.attachSocket(socket);
        resolve();
      };

      const handleError = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const handleCloseBeforeOpen = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error("Remote runtime WebSocket closed before opening."));
      };

      socket.once("open", handleOpen);
      socket.once("error", handleError);
      socket.once("close", handleCloseBeforeOpen);
    });
  }

  send(data: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Remote runtime WebSocket is not connected.");
    }

    this.socket.send(data);
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandlers.add(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.add(handler);
  }

  close(): void {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = undefined;
    socket.close();
  }

  private attachSocket(socket: WebSocket): void {
    this.socket = socket;
    socket.on("message", (data: RawData) => {
      const message = rawDataToString(data);
      for (const handler of this.messageHandlers) {
        handler(message);
      }
    });
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = undefined;
      }
      for (const handler of this.closeHandlers) {
        handler();
      }
    });
  }
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}
