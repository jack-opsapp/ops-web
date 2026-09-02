export class InstagramGraphError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly graphCode?: number,
    public readonly graphSubcode?: number,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "InstagramGraphError";
  }
}

export function isInstagramGraphError(error: unknown): error is InstagramGraphError {
  return error instanceof InstagramGraphError;
}
