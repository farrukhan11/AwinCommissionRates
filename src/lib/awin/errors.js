export class AwinApiError extends Error {
  constructor(status, code, message, retryAfterSeconds) {
    super(message);
    this.name = "AwinApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
