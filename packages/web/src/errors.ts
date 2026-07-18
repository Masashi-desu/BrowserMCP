import type { ProtocolErrorCode } from "@browsermcp/protocol";

export type BrowserMCPErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_STORE_FAILED"
  | "INVALID_CONFIGURATION"
  | "INVALID_BRIDGE_URL"
  | "INSECURE_BRIDGE_URL"
  | "LOCAL_NETWORK_ACCESS_FAILED"
  | "CONNECTION_TIMEOUT"
  | "CONNECTION_FAILED"
  | "CONNECTION_CLOSED"
  | "PROTOCOL_ERROR"
  | "VERSION_MISMATCH"
  | "CAPABILITY_NOT_NEGOTIATED"
  | "REGISTRATION_FAILED"
  | "INVOCATION_TIMEOUT"
  | "INVOCATION_CANCELLED"
  | "HANDLER_ERROR"
  | "REMOTE_ERROR";

export class BrowserMCPError extends Error {
  public readonly code: BrowserMCPErrorCode;
  public readonly retryable: boolean;

  public constructor(
    code: BrowserMCPErrorCode,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BrowserMCPError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export class BrowserMCPRemoteError extends BrowserMCPError {
  public readonly protocolCode: ProtocolErrorCode;
  public readonly details: unknown;

  public constructor(options: {
    protocolCode: ProtocolErrorCode;
    message: string;
    retryable: boolean;
    details?: unknown;
  }) {
    super("REMOTE_ERROR", options.message, { retryable: options.retryable });
    this.name = "BrowserMCPRemoteError";
    this.protocolCode = options.protocolCode;
    this.details = options.details;
  }
}
