export type KbAdapterErrorKind =
  | "not_installed"
  | "vault_invalid"
  | "timeout"
  | "schema_drift"
  | "command_failed";

export class KbAdapterError extends Error {
  constructor(
    public readonly kind: KbAdapterErrorKind,
    message: string,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = "KbAdapterError";
  }
}
