export class ModelApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ModelApiError";
  }
}

export class WorkspaceLockError extends Error {
  constructor(
    message: string,
    public readonly holder?: string
  ) {
    super(message);
    this.name = "WorkspaceLockError";
  }
}
