export type BridgeErrorCode =
  | "AMBIGUOUS_TARGET"
  | "BROWSER_DISCONNECTED"
  | "BROWSER_ERROR"
  | "CANCELLED"
  | "CONCURRENCY_LIMIT"
  | "INVALID_MESSAGE"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "REGISTRATION_CONFLICT"
  | "REGISTRATION_LIMIT"
  | "TIMEOUT";

export class BridgeError extends Error {
  public constructor(
    public readonly code: BridgeErrorCode,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}
