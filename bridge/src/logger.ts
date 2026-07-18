export type LogLevel = "debug" | "error" | "info" | "warn";

export interface LogEntry {
  readonly at: string;
  readonly context?: unknown;
  readonly level: LogLevel;
  readonly message: string;
}

const SECRET_VALUE = /bmp_(?:admin|mcp|pair|resume|ui)_[A-Za-z0-9_-]+/g;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi;
const MAX_LOG_STRING_LENGTH = 2_048;
const CREDENTIAL_FIELD_NAMES = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearertoken",
  "sessiontoken",
  "csrftoken",
  "pairingtoken",
  "resumetoken",
  "mcptoken",
  "admintoken",
  "apikey",
  "auth",
  "authorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "privatekey",
  "credential",
  "credentials",
]);
const CREDENTIAL_QUERY_NAMES = new Set([...CREDENTIAL_FIELD_NAMES, "code"]);

function normalizedCredentialName(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    // A malformed encoded name cannot accidentally match a known credential name.
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCredentialFieldName(value: string): boolean {
  return CREDENTIAL_FIELD_NAMES.has(normalizedCredentialName(value));
}

function isCredentialQueryName(value: string): boolean {
  return CREDENTIAL_QUERY_NAMES.has(normalizedCredentialName(value));
}

function redactUrl(value: string): string {
  const trailingMatch = /[),.;!?]+$/.exec(value);
  const trailing = trailingMatch?.[0] ?? "";
  const candidate = trailing === "" ? value : value.slice(0, -trailing.length);
  try {
    const url = new URL(candidate);
    let changed = false;
    if (url.username !== "" || url.password !== "") {
      url.username = "REDACTED";
      url.password = "REDACTED";
      changed = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isCredentialQueryName(key)) {
        url.searchParams.set(key, "REDACTED");
        changed = true;
      }
    }
    return changed ? `${url.toString()}${trailing}` : value;
  } catch {
    return value;
  }
}

export function safeText(value: string, maxLength = 512): string {
  const redacted = value
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, (url) => redactUrl(url))
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/gi, (pair, prefix, rawName) =>
      isCredentialQueryName(rawName) ? `${prefix}${rawName}=[REDACTED]` : pair,
    )
    .replace(
      /\b([A-Za-z][A-Za-z0-9_-]{0,63})(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/g,
      (assignment, rawName, separator) =>
        isCredentialFieldName(rawName) ? `${rawName}${separator}[REDACTED]` : assignment,
    )
    .replace(SECRET_VALUE, "[REDACTED]")
    .replace(BEARER_VALUE, "Bearer [REDACTED]");
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`;
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return safeText(value, MAX_LOG_STRING_LENGTH);
  }
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = isCredentialFieldName(key) ? "[REDACTED]" : redact(nested, seen);
  }
  return result;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function cloneLogEntry(entry: LogEntry): LogEntry {
  return deepFreeze(redact(entry) as LogEntry);
}

export class RingLogger {
  readonly #entries: LogEntry[] = [];
  readonly #limit: number;
  readonly #sink?: (entry: LogEntry) => void;

  public constructor(limit = 200, sink?: (entry: LogEntry) => void) {
    this.#limit = limit;
    this.#sink = sink;
  }

  public log(level: LogLevel, message: string, context?: unknown): void {
    const safeContext = context === undefined ? undefined : redact(context);
    const entry: LogEntry = deepFreeze({
      at: new Date().toISOString(),
      level,
      message: safeText(message, MAX_LOG_STRING_LENGTH),
      ...(safeContext === undefined ? {} : { context: safeContext }),
    });
    this.#entries.push(entry);
    if (this.#entries.length > this.#limit) this.#entries.shift();
    try {
      this.#sink?.(cloneLogEntry(entry));
    } catch {
      // Diagnostic sinks are best-effort and must never disrupt Bridge control flow.
    }
  }

  public debug(message: string, context?: unknown): void {
    this.log("debug", message, context);
  }

  public error(message: string, context?: unknown): void {
    this.log("error", message, context);
  }

  public info(message: string, context?: unknown): void {
    this.log("info", message, context);
  }

  public warn(message: string, context?: unknown): void {
    this.log("warn", message, context);
  }

  public recent(): readonly LogEntry[] {
    return this.#entries
      .slice()
      .reverse()
      .map((entry) => cloneLogEntry(entry));
  }
}
