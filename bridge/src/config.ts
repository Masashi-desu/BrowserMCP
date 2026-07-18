import { DEFAULT_MAX_MESSAGE_BYTES } from "@browsermcp/protocol";

export const LOOPBACK_HOST = "127.0.0.1" as const;
const MAX_PROTOCOL_REQUEST_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_PROTOCOL_CONCURRENT_INVOCATIONS = 10_000;
const MIN_PROTOCOL_MESSAGE_BYTES = 1_024;

export interface BridgeLimits {
  readonly browserHandshakeTimeoutMs: number;
  readonly browserRequestTimeoutMs: number;
  readonly httpHeadersTimeoutMs: number;
  readonly httpKeepAliveTimeoutMs: number;
  readonly httpRequestTimeoutMs: number;
  readonly maxBrowserConnections: number;
  readonly maxConcurrentRequests: number;
  readonly maxConcurrentRequestsPerRuntime: number;
  readonly maxHttpBodyBytes: number;
  readonly maxHttpConnections: number;
  readonly maxMcpSessions: number;
  readonly maxRegistrationBytesPerRuntime: number;
  readonly maxRegistrationBytesTotal: number;
  readonly maxRegistrationsPerRuntime: number;
  readonly maxRegistrationsTotal: number;
  readonly maxWebSocketPayloadBytes: number;
  readonly mcpSessionIdleTtlMs: number;
  readonly mcpSessionSweepIntervalMs: number;
  readonly pairingTokenTtlMs: number;
  readonly resumeTokenTtlMs: number;
  readonly uiSessionTtlMs: number;
}

export interface BridgeConfig {
  /** Deliberately not configurable: BrowserMCP never listens beyond IPv4 loopback. */
  readonly host: typeof LOOPBACK_HOST;
  readonly port: number;
  readonly limits: BridgeLimits;
  readonly allowedOrigins: readonly string[];
  readonly tls?: {
    readonly certPath: string;
    readonly keyPath: string;
  };
  /** Optional fixed values are intended for deterministic tests only. */
  readonly mcpBearerToken?: string;
  readonly adminBearerToken?: string;
}

export const DEFAULT_LIMITS: BridgeLimits = Object.freeze({
  browserHandshakeTimeoutMs: 5_000,
  browserRequestTimeoutMs: 30_000,
  httpHeadersTimeoutMs: 10_000,
  httpKeepAliveTimeoutMs: 5_000,
  httpRequestTimeoutMs: 30_000,
  maxBrowserConnections: 16,
  maxConcurrentRequests: 64,
  maxConcurrentRequestsPerRuntime: 8,
  maxHttpBodyBytes: 1_048_576,
  maxHttpConnections: 128,
  maxMcpSessions: 64,
  maxRegistrationBytesPerRuntime: 2_097_152,
  maxRegistrationBytesTotal: 16_777_216,
  maxRegistrationsPerRuntime: 256,
  maxRegistrationsTotal: 2_048,
  maxWebSocketPayloadBytes: 1_048_576,
  mcpSessionIdleTtlMs: 900_000,
  mcpSessionSweepIntervalMs: 60_000,
  pairingTokenTtlMs: 120_000,
  resumeTokenTtlMs: 300_000,
  uiSessionTtlMs: 3_600_000,
});

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be a positive base-10 integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive base-10 integer`);
  }
  return parsed;
}

function assertPositiveSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

/**
 * Enforces security and wire-level invariants even for JavaScript callers that bypass TypeScript.
 * The returned object is detached from caller-owned arrays/objects so later mutation cannot alter
 * the listener address or active limits.
 */
export function normalizeBridgeConfig(config: BridgeConfig): BridgeConfig {
  if (config === null || typeof config !== "object") {
    throw new Error("Bridge config must be an object");
  }
  if (config.host !== LOOPBACK_HOST) {
    throw new Error(`Bridge host must be exactly ${LOOPBACK_HOST}`);
  }
  if (!Number.isSafeInteger(config.port) || config.port < 0 || config.port > 65_535) {
    throw new Error("Bridge port must be an integer from 0 to 65535");
  }
  if (
    !Array.isArray(config.allowedOrigins) ||
    config.allowedOrigins.some((value) => typeof value !== "string")
  ) {
    throw new Error("Bridge allowedOrigins must be an array of strings");
  }

  if (config.limits === null || typeof config.limits !== "object" || Array.isArray(config.limits)) {
    throw new Error("Bridge limits must be an object");
  }
  const limits = { ...config.limits };
  const limitNames = Object.keys(DEFAULT_LIMITS) as (keyof BridgeLimits)[];
  const knownLimitNames = new Set<string>(limitNames);
  for (const name of Object.keys(limits)) {
    if (!knownLimitNames.has(name)) throw new Error(`Unknown Bridge limit ${name}`);
  }
  for (const name of limitNames) {
    assertPositiveSafeInteger(limits[name], `Bridge limit ${name}`);
  }
  if (limits.httpHeadersTimeoutMs > limits.httpRequestTimeoutMs) {
    throw new Error("Bridge HTTP header timeout must not exceed request timeout");
  }
  if (limits.maxConcurrentRequestsPerRuntime > limits.maxConcurrentRequests) {
    throw new Error("Per-runtime concurrency must not exceed Bridge concurrency");
  }
  if (limits.maxConcurrentRequestsPerRuntime > MAX_PROTOCOL_CONCURRENT_INVOCATIONS) {
    throw new Error(
      `Per-runtime concurrency must not exceed ${MAX_PROTOCOL_CONCURRENT_INVOCATIONS}`,
    );
  }
  if (limits.browserRequestTimeoutMs > MAX_PROTOCOL_REQUEST_TIMEOUT_MS) {
    throw new Error(
      `Browser request timeout must not exceed ${MAX_PROTOCOL_REQUEST_TIMEOUT_MS} ms`,
    );
  }
  if (limits.maxWebSocketPayloadBytes < MIN_PROTOCOL_MESSAGE_BYTES) {
    throw new Error(`WebSocket payload limit must be at least ${MIN_PROTOCOL_MESSAGE_BYTES} bytes`);
  }
  if (limits.maxWebSocketPayloadBytes > DEFAULT_MAX_MESSAGE_BYTES) {
    throw new Error(`WebSocket payload limit must not exceed ${DEFAULT_MAX_MESSAGE_BYTES} bytes`);
  }
  if (limits.maxRegistrationsPerRuntime > limits.maxRegistrationsTotal) {
    throw new Error("Per-runtime registration count must not exceed the Bridge total");
  }
  if (limits.maxRegistrationBytesPerRuntime > limits.maxRegistrationBytesTotal) {
    throw new Error("Per-runtime registration bytes must not exceed the Bridge total");
  }
  if (config.tls !== undefined) {
    if (
      typeof config.tls.certPath !== "string" ||
      config.tls.certPath.trim() === "" ||
      typeof config.tls.keyPath !== "string" ||
      config.tls.keyPath.trim() === ""
    ) {
      throw new Error("TLS certificate and key paths must be non-empty strings");
    }
  }

  return Object.freeze({
    host: LOOPBACK_HOST,
    port: config.port,
    allowedOrigins: Object.freeze([...config.allowedOrigins]),
    limits: Object.freeze(limits),
    ...(config.tls === undefined ? {} : { tls: Object.freeze({ ...config.tls }) }),
    ...(config.mcpBearerToken === undefined ? {} : { mcpBearerToken: config.mcpBearerToken }),
    ...(config.adminBearerToken === undefined ? {} : { adminBearerToken: config.adminBearerToken }),
  });
}

export function configFromEnvironment(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const port = positiveInteger(env.BROWSERMCP_PORT, 8789, "BROWSERMCP_PORT");
  if (port > 65_535) throw new Error("BROWSERMCP_PORT must be at most 65535");

  const certPath = env.BROWSERMCP_TLS_CERT;
  const keyPath = env.BROWSERMCP_TLS_KEY;
  if ((certPath === undefined) !== (keyPath === undefined)) {
    throw new Error("BROWSERMCP_TLS_CERT and BROWSERMCP_TLS_KEY must be set together");
  }
  const allowedOrigins = (env.BROWSERMCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const limits: BridgeLimits = {
    ...DEFAULT_LIMITS,
    browserRequestTimeoutMs: positiveInteger(
      env.BROWSERMCP_REQUEST_TIMEOUT_MS,
      DEFAULT_LIMITS.browserRequestTimeoutMs,
      "BROWSERMCP_REQUEST_TIMEOUT_MS",
    ),
    httpHeadersTimeoutMs: positiveInteger(
      env.BROWSERMCP_HTTP_HEADERS_TIMEOUT_MS,
      DEFAULT_LIMITS.httpHeadersTimeoutMs,
      "BROWSERMCP_HTTP_HEADERS_TIMEOUT_MS",
    ),
    httpKeepAliveTimeoutMs: positiveInteger(
      env.BROWSERMCP_HTTP_KEEP_ALIVE_TIMEOUT_MS,
      DEFAULT_LIMITS.httpKeepAliveTimeoutMs,
      "BROWSERMCP_HTTP_KEEP_ALIVE_TIMEOUT_MS",
    ),
    httpRequestTimeoutMs: positiveInteger(
      env.BROWSERMCP_HTTP_REQUEST_TIMEOUT_MS,
      DEFAULT_LIMITS.httpRequestTimeoutMs,
      "BROWSERMCP_HTTP_REQUEST_TIMEOUT_MS",
    ),
    maxConcurrentRequests: positiveInteger(
      env.BROWSERMCP_MAX_CONCURRENT_REQUESTS,
      DEFAULT_LIMITS.maxConcurrentRequests,
      "BROWSERMCP_MAX_CONCURRENT_REQUESTS",
    ),
    maxConcurrentRequestsPerRuntime: positiveInteger(
      env.BROWSERMCP_MAX_CONCURRENT_PER_RUNTIME,
      DEFAULT_LIMITS.maxConcurrentRequestsPerRuntime,
      "BROWSERMCP_MAX_CONCURRENT_PER_RUNTIME",
    ),
    maxHttpBodyBytes: positiveInteger(
      env.BROWSERMCP_MAX_HTTP_BODY_BYTES,
      DEFAULT_LIMITS.maxHttpBodyBytes,
      "BROWSERMCP_MAX_HTTP_BODY_BYTES",
    ),
    maxHttpConnections: positiveInteger(
      env.BROWSERMCP_MAX_HTTP_CONNECTIONS,
      DEFAULT_LIMITS.maxHttpConnections,
      "BROWSERMCP_MAX_HTTP_CONNECTIONS",
    ),
    maxMcpSessions: positiveInteger(
      env.BROWSERMCP_MAX_MCP_SESSIONS,
      DEFAULT_LIMITS.maxMcpSessions,
      "BROWSERMCP_MAX_MCP_SESSIONS",
    ),
    maxRegistrationBytesPerRuntime: positiveInteger(
      env.BROWSERMCP_MAX_REGISTRATION_BYTES_PER_RUNTIME,
      DEFAULT_LIMITS.maxRegistrationBytesPerRuntime,
      "BROWSERMCP_MAX_REGISTRATION_BYTES_PER_RUNTIME",
    ),
    maxRegistrationBytesTotal: positiveInteger(
      env.BROWSERMCP_MAX_REGISTRATION_BYTES_TOTAL,
      DEFAULT_LIMITS.maxRegistrationBytesTotal,
      "BROWSERMCP_MAX_REGISTRATION_BYTES_TOTAL",
    ),
    maxRegistrationsPerRuntime: positiveInteger(
      env.BROWSERMCP_MAX_REGISTRATIONS_PER_RUNTIME,
      DEFAULT_LIMITS.maxRegistrationsPerRuntime,
      "BROWSERMCP_MAX_REGISTRATIONS_PER_RUNTIME",
    ),
    maxRegistrationsTotal: positiveInteger(
      env.BROWSERMCP_MAX_REGISTRATIONS_TOTAL,
      DEFAULT_LIMITS.maxRegistrationsTotal,
      "BROWSERMCP_MAX_REGISTRATIONS_TOTAL",
    ),
    maxWebSocketPayloadBytes: positiveInteger(
      env.BROWSERMCP_MAX_WS_PAYLOAD_BYTES,
      DEFAULT_LIMITS.maxWebSocketPayloadBytes,
      "BROWSERMCP_MAX_WS_PAYLOAD_BYTES",
    ),
    mcpSessionIdleTtlMs: positiveInteger(
      env.BROWSERMCP_MCP_SESSION_IDLE_TTL_MS,
      DEFAULT_LIMITS.mcpSessionIdleTtlMs,
      "BROWSERMCP_MCP_SESSION_IDLE_TTL_MS",
    ),
    mcpSessionSweepIntervalMs: positiveInteger(
      env.BROWSERMCP_MCP_SESSION_SWEEP_INTERVAL_MS,
      DEFAULT_LIMITS.mcpSessionSweepIntervalMs,
      "BROWSERMCP_MCP_SESSION_SWEEP_INTERVAL_MS",
    ),
  };
  if (limits.httpHeadersTimeoutMs > limits.httpRequestTimeoutMs) {
    throw new Error(
      "BROWSERMCP_HTTP_HEADERS_TIMEOUT_MS must not exceed BROWSERMCP_HTTP_REQUEST_TIMEOUT_MS",
    );
  }
  if (limits.maxRegistrationsPerRuntime > limits.maxRegistrationsTotal) {
    throw new Error(
      "BROWSERMCP_MAX_REGISTRATIONS_PER_RUNTIME must not exceed BROWSERMCP_MAX_REGISTRATIONS_TOTAL",
    );
  }
  if (limits.maxRegistrationBytesPerRuntime > limits.maxRegistrationBytesTotal) {
    throw new Error(
      "BROWSERMCP_MAX_REGISTRATION_BYTES_PER_RUNTIME must not exceed BROWSERMCP_MAX_REGISTRATION_BYTES_TOTAL",
    );
  }

  return normalizeBridgeConfig({
    host: LOOPBACK_HOST,
    port,
    allowedOrigins,
    ...(certPath && keyPath ? { tls: { certPath, keyPath } } : {}),
    limits,
  });
}
