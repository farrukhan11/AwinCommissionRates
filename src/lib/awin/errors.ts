export type AwinErrorCode =
  | "AWIN_UNAUTHORIZED"
  | "AWIN_FORBIDDEN"
  | "AWIN_NOT_FOUND"
  | "AWIN_RATE_LIMITED"
  | "AWIN_SERVER_ERROR"
  | "AWIN_TIMEOUT"
  | "AWIN_INVALID_RESPONSE"
  | "AWIN_REQUEST_FAILED"
  | "AWIN_CONFIG_ERROR";

export class AwinApiError extends Error {
  status: number;
  code: AwinErrorCode;
  retryAfterSeconds?: number;

  constructor(
    status: number,
    code: AwinErrorCode,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AwinApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
