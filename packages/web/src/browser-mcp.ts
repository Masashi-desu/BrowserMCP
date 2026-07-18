import {
  type BridgeMessage,
  type BridgeMessageOfType,
  type CapabilityRegistration,
  type ConnectionAuth,
  createBridgeMessage,
  type InvocationOperation,
  type InvocationResult,
  type JsonObject,
  type JsonValue,
  KNOWN_PROTOCOL_CAPABILITIES,
  type ProtocolCapability,
  type ProtocolLimits,
  parseBridgeMessage,
  type SessionInfo,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@browsermcp/protocol";

import { BrowserMCPError, BrowserMCPRemoteError } from "./errors.js";
import {
  DEFAULT_BRIDGE_URL,
  prepareLocalNetworkAccess as prepareLoopbackAccess,
  validateBridgeUrl,
} from "./local-network.js";
import type {
  BrowserMCPLogEntry,
  BrowserMCPOptions,
  BrowserMCPSessionInfo,
  BrowserMCPSessionStore,
  BrowserMCPSnapshot,
  BrowserMCPSubscriber,
  ConnectionState,
  ConnectOptions,
  DisconnectOptions,
  ExecutionRecord,
  InvocationContext,
  LocalNetworkAccessOptions,
  LocalNetworkAccessResult,
  PromptHandlerResult,
  ReconnectOptions,
  RegistrationHandle,
  RegistrationSnapshot,
  RegistrationStatus,
  ResourceHandlerResult,
  StoredBrowserMCPSession,
  WebPromptDefinition,
  WebResourceDefinition,
  WebSocketCloseEvent,
  WebSocketFactory,
  WebSocketLike,
  WebSocketMessageEvent,
  WebToolDefinition,
} from "./types.js";

const OPEN = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 7_500;
const DEFAULT_APPROVAL_TIMEOUT_MS = 130_000;
const DEFAULT_INVOCATION_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RECENT_EXECUTIONS = 50;
const DEFAULT_MAX_LOG_ENTRIES = 200;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

const DEFAULT_RECONNECT: Required<ReconnectOptions> = Object.freeze({
  maxAttempts: 5,
  initialDelayMs: 250,
  maxDelayMs: 5_000,
  factor: 2,
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface PendingReply {
  readonly expectedType: "registered" | "unregistered";
  readonly registrationId: string;
  readonly resolve: (message: BridgeMessage) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ActiveInvocation {
  readonly controller: AbortController;
  readonly timer: ReturnType<typeof setTimeout>;
}

type InternalExecutor = (
  operation: InvocationOperation,
  context: InvocationContext,
) => Promise<InvocationResult>;

interface InternalRegistration {
  readonly wire: CapabilityRegistration;
  readonly execute: InternalExecutor;
  readonly waiters: Set<Deferred<void>>;
  status: RegistrationStatus;
  error?: BrowserMCPError;
}

interface NormalizedOptions {
  readonly app: { id: string; name: string; version: string };
  readonly bridgeUrl: string;
  readonly getToken?: () => string | Promise<string>;
  readonly origin: string;
  readonly runtimeId: string;
  readonly instanceId: string;
  readonly webSocketFactory: WebSocketFactory;
  readonly reconnect: false | Required<ReconnectOptions>;
  readonly connectTimeoutMs: number;
  readonly approvalTimeoutMs: number;
  readonly invocationTimeoutMs: number;
  readonly maxRecentExecutions: number;
  readonly maxLogEntries: number;
  readonly logger?: (entry: BrowserMCPLogEntry) => void;
  readonly sessionStore: BrowserMCPSessionStore;
  readonly prepareLocalNetworkAccess: boolean | LocalNetworkAccessOptions;
}

class MemorySessionStore implements BrowserMCPSessionStore {
  #value: StoredBrowserMCPSession | undefined;

  public load(): StoredBrowserMCPSession | undefined {
    return this.#value;
  }

  public save(_appId: string, value: StoredBrowserMCPSession): void {
    this.#value = value;
  }

  public clear(): void {
    this.#value = undefined;
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function randomId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `${prefix}:${random}`;
}

function defaultAppId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return slug === "" ? randomId("app") : `app:${slug}`;
}

function currentOrigin(configured?: string): string {
  const origin = configured ?? globalThis.location?.origin;
  if (origin === undefined || origin === "null") {
    throw new BrowserMCPError(
      "INVALID_CONFIGURATION",
      "A non-opaque http(s) origin is required to connect to BrowserMCP",
    );
  }
  return origin;
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  if (typeof globalThis.WebSocket !== "function") {
    throw new BrowserMCPError(
      "INVALID_CONFIGURATION",
      "WebSocket is unavailable; provide webSocketFactory in this environment",
    );
  }
  return new globalThis.WebSocket(url) as unknown as WebSocketLike;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new BrowserMCPError("INVALID_CONFIGURATION", `${name} must be a positive safe integer`);
  }
  return normalized;
}

function normalizeReconnect(
  value: false | ReconnectOptions | undefined,
): false | Required<ReconnectOptions> {
  if (value === false) return false;
  const maxAttempts = value?.maxAttempts ?? DEFAULT_RECONNECT.maxAttempts;
  const initialDelayMs = value?.initialDelayMs ?? DEFAULT_RECONNECT.initialDelayMs;
  const maxDelayMs = value?.maxDelayMs ?? DEFAULT_RECONNECT.maxDelayMs;
  const factor = value?.factor ?? DEFAULT_RECONNECT.factor;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 0) {
    throw new BrowserMCPError(
      "INVALID_CONFIGURATION",
      "reconnect.maxAttempts must be a non-negative safe integer",
    );
  }
  if (
    !Number.isSafeInteger(initialDelayMs) ||
    initialDelayMs < 0 ||
    !Number.isSafeInteger(maxDelayMs) ||
    maxDelayMs < initialDelayMs ||
    !Number.isFinite(factor) ||
    factor < 1
  ) {
    throw new BrowserMCPError("INVALID_CONFIGURATION", "Reconnect delay values are invalid");
  }
  return { maxAttempts, initialDelayMs, maxDelayMs, factor };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreezeJson(entry);
    return Object.freeze(value) as unknown as JsonValue;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreezeJson(entry);
    return Object.freeze(value);
  }
  return value;
}

const CREDENTIAL_QUERY_NAMES = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "privatekey",
  "apikey",
  "auth",
  "authorization",
  "code",
  "password",
  "passwd",
  "secret",
  "credential",
]);

function normalizedCredentialName(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value.replace(/\+/gu, " "));
  } catch {
    // A malformed encoded name cannot match a known credential parameter accidentally.
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isCredentialQueryName(value: string): boolean {
  return CREDENTIAL_QUERY_NAMES.has(normalizedCredentialName(value));
}

function isCredentialFieldName(value: string): boolean {
  const normalized = normalizedCredentialName(value);
  return (
    CREDENTIAL_QUERY_NAMES.has(normalized) ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("privatekey")
  );
}

function redactUrl(value: string): string {
  const trailingMatch = /[),.;!?]+$/u.exec(value);
  const trailing = trailingMatch?.[0] ?? "";
  const candidate = trailing === "" ? value : value.slice(0, -trailing.length);
  try {
    const url = new URL(candidate);
    if (url.username !== "" || url.password !== "") {
      url.username = "REDACTED";
      url.password = "REDACTED";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isCredentialQueryName(key)) url.searchParams.set(key, "REDACTED");
    }
    return `${url.toString()}${trailing}`;
  } catch {
    return value;
  }
}

function redactText(value: string, maxLength = MAX_ERROR_MESSAGE_LENGTH): string {
  return value
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/giu, (url) => redactUrl(url))
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/giu, (pair, prefix, rawName) =>
      isCredentialQueryName(rawName as string)
        ? `${prefix as string}${rawName as string}=[REDACTED]`
        : (pair as string),
    )
    .replace(/\b([A-Za-z][A-Za-z0-9_-]{1,63})=([^\s&,;]+)/gu, (pair, rawName) =>
      isCredentialFieldName(rawName as string)
        ? `${rawName as string}=[REDACTED]`
        : (pair as string),
    )
    .replace(/bmp_(?:admin|mcp|pair|resume|ui)_[A-Za-z0-9_-]+/giu, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .slice(0, maxLength);
}

function safeMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  const redacted = redactText(message);
  if (redacted.trim() !== "") return redacted;
  const safeFallback = redactText(fallback);
  return safeFallback.trim() === "" ? "BrowserMCP operation failed" : safeFallback;
}

function publicSession(session: SessionInfo): BrowserMCPSessionInfo {
  return { id: session.id, expiresAt: session.expiresAt };
}

function redactJson(value: JsonValue, key = ""): JsonValue {
  if (isCredentialFieldName(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((entry) => redactJson(entry));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [entryKey, redactJson(entry, entryKey)]),
  );
}

function redactError(error: BrowserMCPError): BrowserMCPError {
  const message = redactText(error.message);
  if (error instanceof BrowserMCPRemoteError) {
    let details: unknown;
    try {
      details = redactJson(cloneJson(error.details) as JsonValue);
    } catch {
      details = undefined;
    }
    return new BrowserMCPRemoteError({
      protocolCode: error.protocolCode,
      message,
      retryable: error.retryable,
      ...(details === undefined ? {} : { details }),
    });
  }
  if (message === error.message) return error;
  return new BrowserMCPError(error.code, message, {
    cause: error,
    retryable: error.retryable,
  });
}

function registrationCapability(kind: CapabilityRegistration["kind"]): ProtocolCapability {
  if (kind === "tool") return "tools";
  if (kind === "resource") return "resources";
  return "prompts";
}

function assertOperationKind(
  registration: CapabilityRegistration,
  operation: InvocationOperation,
): void {
  const expected =
    registration.kind === "tool"
      ? "tool.call"
      : registration.kind === "resource"
        ? "resource.read"
        : "prompt.get";
  if (operation.kind !== expected) {
    throw new BrowserMCPError(
      "PROTOCOL_ERROR",
      `Registration ${registration.id} cannot execute ${operation.kind}`,
    );
  }
  if (
    registration.kind === "resource" &&
    operation.kind === "resource.read" &&
    operation.uri !== registration.uri
  ) {
    throw new BrowserMCPError(
      "PROTOCOL_ERROR",
      `Resource registration ${registration.id} does not provide the requested URI`,
    );
  }
}

export class BrowserMCP {
  readonly #options: NormalizedOptions;
  readonly #registrations = new Map<string, InternalRegistration>();
  readonly #subscribers = new Set<BrowserMCPSubscriber>();
  readonly #logs: BrowserMCPLogEntry[] = [];
  readonly #recentExecutions: ExecutionRecord[] = [];
  readonly #pendingReplies = new Map<string, PendingReply>();
  readonly #activeInvocations = new Map<string, ActiveInvocation>();

  #connectionState: ConnectionState = "idle";
  #session: SessionInfo | undefined;
  #negotiatedCapabilities: ProtocolCapability[] = [];
  #limits: ProtocolLimits | undefined;
  #lastError: BrowserMCPError | undefined;
  #socket: WebSocketLike | undefined;
  #connectPromise: Promise<BrowserMCPSessionInfo> | undefined;
  #disconnectPromise: Promise<void> | undefined;
  #reconnectPromise: Promise<BrowserMCPSessionInfo> | undefined;
  #connectAbort: AbortController | undefined;
  #handshake: Deferred<BrowserMCPSessionInfo> | undefined;
  #connectMessageId: string | undefined;
  #connectTimer:
    | { readonly generation: number; readonly timer: ReturnType<typeof setTimeout> }
    | undefined;
  #approval:
    | { readonly requestId: string; readonly origin: string; readonly expiresAt: number }
    | undefined;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #reconnectAttempt = 0;
  #manualClose = false;
  #suppressReconnectOnce = false;
  #oneShotPairingToken: string | undefined;
  #connectionGeneration = 0;
  #sessionStoreTail: Promise<void> = Promise.resolve();

  public constructor(options: BrowserMCPOptions) {
    const name = options.name.trim();
    if (name === "") {
      throw new BrowserMCPError("INVALID_CONFIGURATION", "App name is required");
    }
    const origin = currentOrigin(options.origin);
    const bridgeUrl = options.bridgeUrl ?? DEFAULT_BRIDGE_URL;
    const appId = options.appId ?? defaultAppId(name);
    validateBridgeUrl(bridgeUrl, origin);
    this.#oneShotPairingToken = options.token;
    this.#options = {
      app: {
        id: appId,
        name,
        version: options.version,
      },
      bridgeUrl,
      ...(options.getToken === undefined ? {} : { getToken: options.getToken }),
      origin,
      runtimeId: options.runtimeId ?? appId,
      instanceId: options.instanceId ?? randomId("instance"),
      webSocketFactory: options.webSocketFactory ?? defaultWebSocketFactory,
      reconnect: normalizeReconnect(options.reconnect),
      connectTimeoutMs: positiveInteger(
        options.connectTimeoutMs,
        DEFAULT_CONNECT_TIMEOUT_MS,
        "connectTimeoutMs",
      ),
      approvalTimeoutMs: positiveInteger(
        options.approvalTimeoutMs,
        DEFAULT_APPROVAL_TIMEOUT_MS,
        "approvalTimeoutMs",
      ),
      invocationTimeoutMs: positiveInteger(
        options.invocationTimeoutMs,
        DEFAULT_INVOCATION_TIMEOUT_MS,
        "invocationTimeoutMs",
      ),
      maxRecentExecutions: positiveInteger(
        options.maxRecentExecutions,
        DEFAULT_MAX_RECENT_EXECUTIONS,
        "maxRecentExecutions",
      ),
      maxLogEntries: positiveInteger(
        options.maxLogEntries,
        DEFAULT_MAX_LOG_ENTRIES,
        "maxLogEntries",
      ),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      sessionStore: options.sessionStore ?? new MemorySessionStore(),
      prepareLocalNetworkAccess: options.prepareLocalNetworkAccess ?? false,
    };

    // Validate app/runtime/origin eagerly using the shared wire validator.
    createBridgeMessage(
      "connect",
      {
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
        auth: { kind: "pairing", token: "validation-token-000000000000" },
        app: this.#options.app,
        origin: this.#options.origin,
        runtime: {
          id: this.#options.runtimeId,
          instanceId: this.#options.instanceId,
        },
      },
      { id: "validation-message", timestamp: 0 },
    );
  }

  public get bridgeUrl(): string {
    return this.#options.bridgeUrl;
  }

  public get connectionState(): ConnectionState {
    return this.#connectionState;
  }

  public tool<TArguments extends JsonObject = JsonObject>(
    definition: WebToolDefinition<TArguments>,
  ): RegistrationHandle {
    const registration: CapabilityRegistration = {
      kind: "tool",
      id: randomId("tool"),
      name: definition.name,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      inputSchema: cloneJson(definition.inputSchema),
      ...(definition.outputSchema === undefined
        ? {}
        : { outputSchema: cloneJson(definition.outputSchema) }),
      ...(definition.annotations === undefined
        ? {}
        : { annotations: cloneJson(definition.annotations) }),
    };
    const executor: InternalExecutor = async (operation, context) => {
      assertOperationKind(registration, operation);
      const result = await definition.handler(
        (operation as Extract<InvocationOperation, { kind: "tool.call" }>).arguments as TArguments,
        context,
      );
      return { ...result, kind: "tool" };
    };
    return this.#addRegistration(registration, executor);
  }

  public resource(definition: WebResourceDefinition): RegistrationHandle {
    const registration: CapabilityRegistration = {
      kind: "resource",
      id: randomId("resource"),
      name: definition.name,
      uri: definition.uri,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.mimeType === undefined ? {} : { mimeType: definition.mimeType }),
      ...(definition.annotations === undefined
        ? {}
        : { annotations: cloneJson(definition.annotations) }),
    };
    const executor: InternalExecutor = async (operation, context) => {
      assertOperationKind(registration, operation);
      const request = operation as Extract<InvocationOperation, { kind: "resource.read" }>;
      const result: ResourceHandlerResult = await definition.handler({ uri: request.uri }, context);
      return { ...result, kind: "resource" };
    };
    return this.#addRegistration(registration, executor);
  }

  public prompt(definition: WebPromptDefinition): RegistrationHandle {
    const registration: CapabilityRegistration = {
      kind: "prompt",
      id: randomId("prompt"),
      name: definition.name,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.arguments === undefined
        ? {}
        : { arguments: definition.arguments.map((argument) => ({ ...argument })) }),
      ...(definition.annotations === undefined
        ? {}
        : { annotations: cloneJson(definition.annotations) }),
    };
    const executor: InternalExecutor = async (operation, context) => {
      assertOperationKind(registration, operation);
      const request = operation as Extract<InvocationOperation, { kind: "prompt.get" }>;
      const result: PromptHandlerResult = await definition.handler(
        request.arguments ?? {},
        context,
      );
      return { ...result, kind: "prompt" };
    };
    return this.#addRegistration(registration, executor);
  }

  public async unregister(registrationId: string): Promise<boolean> {
    const registration = this.#registrations.get(registrationId);
    if (registration === undefined) return false;

    if (
      this.#connectionState === "connected" &&
      this.#session !== undefined &&
      (registration.status === "registered" || registration.status === "registering")
    ) {
      const message = createBridgeMessage("unregister", {
        sessionId: this.#session.id,
        registrationId,
      });
      try {
        await this.#sendForReply(message, "unregistered");
      } catch (error) {
        this.#log("warn", "registration.unregister_failed", {
          registrationId,
          message: safeMessage(error, "Registration removal failed"),
        });
        throw error;
      }
    }
    this.#registrations.delete(registrationId);
    for (const waiter of registration.waiters) {
      waiter.reject(
        new BrowserMCPError(
          "REGISTRATION_FAILED",
          "Registration was removed before it became ready",
        ),
      );
    }
    registration.waiters.clear();
    this.#emit();
    this.#log("info", "registration.removed", { registrationId });
    return true;
  }

  public connect(options: ConnectOptions = {}): Promise<BrowserMCPSessionInfo> {
    if (this.#disconnectPromise !== undefined) {
      return this.#disconnectPromise.catch(() => undefined).then(() => this.connect(options));
    }
    if (this.#reconnectPromise !== undefined) return this.#reconnectPromise;
    if (this.#session !== undefined && this.#connectionState === "connected") {
      return Promise.resolve(publicSession(this.#session));
    }
    if (this.#connectPromise !== undefined) return this.#connectPromise;
    this.#cancelReconnect();
    return this.#beginConnect(options, false);
  }

  public disconnect(options: DisconnectOptions = {}): Promise<void> {
    if (this.#disconnectPromise !== undefined) return this.#disconnectPromise;
    const operation =
      this.#reconnectPromise === undefined
        ? this.#disconnectInternal(options)
        : this.#reconnectPromise
            .catch(() => undefined)
            .then(async () => await this.#disconnectInternal(options));
    this.#disconnectPromise = operation;
    void operation.then(
      () => {
        if (this.#disconnectPromise === operation) this.#disconnectPromise = undefined;
      },
      () => {
        if (this.#disconnectPromise === operation) this.#disconnectPromise = undefined;
      },
    );
    return operation;
  }

  async #disconnectInternal(options: DisconnectOptions): Promise<void> {
    this.#cancelReconnect();
    this.#manualClose = true;
    this.#setState("disconnecting");
    const activeAttempt = this.#connectPromise;
    const socket = this.#socket;
    this.#connectAbort?.abort(
      new BrowserMCPError("CONNECTION_CLOSED", "Connection attempt was cancelled by disconnect"),
    );
    let failure: BrowserMCPError | undefined;
    try {
      if (socket?.readyState === OPEN) {
        try {
          this.#send(
            createBridgeMessage("disconnect", {
              ...(this.#session === undefined ? {} : { sessionId: this.#session.id }),
              code: "CLIENT_DISCONNECT",
              ...(options.reason === undefined ? {} : { reason: options.reason }),
              canResume: options.preserveSession ?? false,
            }),
          );
        } catch (cause) {
          failure = this.#connectionFailure(cause, "Could not send the disconnect message");
        }
      }
      if (socket !== undefined) await this.#closeAndWait(socket, 1000, "Client disconnect");
      await activeAttempt?.catch(() => undefined);
      if (options.preserveSession !== true) {
        try {
          await this.#clearStoredSession();
        } catch (cause) {
          failure ??= this.#connectionFailure(cause, "Could not clear the session store");
        }
      }
    } finally {
      if (this.#socket === socket) {
        this.#socket = undefined;
        this.#rejectTransportWork(
          new BrowserMCPError("CONNECTION_CLOSED", "BrowserMCP disconnected"),
        );
      }
      if (options.preserveSession !== true) this.#clearSessionMemory();
      this.#setState("disconnected", failure);
      this.#manualClose = false;
      this.#log(failure === undefined ? "info" : "warn", "connection.disconnected", {
        preserveSession: options.preserveSession ?? false,
        storeCleared: failure?.code !== "SESSION_STORE_FAILED",
      });
    }
    if (failure !== undefined) throw failure;
  }

  public reconnect(): Promise<BrowserMCPSessionInfo> {
    if (this.#reconnectPromise !== undefined) return this.#reconnectPromise;
    const operation = this.#reconnectInternal();
    this.#reconnectPromise = operation;
    void operation.then(
      () => {
        if (this.#reconnectPromise === operation) this.#reconnectPromise = undefined;
      },
      () => {
        if (this.#reconnectPromise === operation) this.#reconnectPromise = undefined;
      },
    );
    return operation;
  }

  async #reconnectInternal(): Promise<BrowserMCPSessionInfo> {
    await this.#disconnectPromise?.catch(() => undefined);
    this.#cancelReconnect();
    const activeAttempt = this.#connectPromise;
    const socket = this.#socket;
    this.#manualClose = true;
    this.#connectAbort?.abort(
      new BrowserMCPError("CONNECTION_CLOSED", "Connection attempt was superseded by reconnect"),
    );
    if (socket?.readyState === OPEN) {
      try {
        this.#send(
          createBridgeMessage("disconnect", {
            ...(this.#session === undefined ? {} : { sessionId: this.#session.id }),
            code: "CLIENT_RECONNECT",
            reason: "Client requested reconnect",
            canResume: true,
          }),
        );
      } catch (cause) {
        this.#log("warn", "connection.reconnect_disconnect_failed", {
          message: safeMessage(cause, "Could not send reconnect disconnect message"),
        });
      }
    }
    if (socket !== undefined) await this.#closeAndWait(socket, 1000, "Client reconnect");
    if (this.#socket === socket) {
      this.#socket = undefined;
      this.#rejectTransportWork(
        new BrowserMCPError("CONNECTION_CLOSED", "Transport restarted for reconnect", {
          retryable: true,
        }),
      );
    }
    await activeAttempt?.catch(() => undefined);
    this.#manualClose = false;
    return this.#beginConnect({ requestApproval: true }, true);
  }

  public prepareLocalNetworkAccess(
    options: LocalNetworkAccessOptions = {},
  ): Promise<LocalNetworkAccessResult> {
    return prepareLoopbackAccess(this.#options.bridgeUrl, {
      ...options,
      pageOrigin: this.#options.origin,
    });
  }

  public subscribe(subscriber: BrowserMCPSubscriber): () => void {
    this.#subscribers.add(subscriber);
    subscriber(this.getSnapshot());
    return () => this.#subscribers.delete(subscriber);
  }

  public getSnapshot(): BrowserMCPSnapshot {
    return {
      app: { ...this.#options.app },
      connectionState: this.#connectionState,
      ...(this.#approval === undefined ? {} : { approval: { ...this.#approval } }),
      ...(this.#session === undefined ? {} : { session: publicSession(this.#session) }),
      negotiatedCapabilities: [...this.#negotiatedCapabilities],
      ...(this.#limits === undefined ? {} : { limits: { ...this.#limits } }),
      registrations: this.getRegistrations(),
      recentExecutions: this.getRecentExecutions(),
      ...(this.#lastError === undefined
        ? {}
        : {
            lastError: {
              code: this.#lastError.code,
              message: this.#lastError.message,
            },
          }),
      reconnectAttempt: this.#reconnectAttempt,
    };
  }

  public getRegistrations(): readonly RegistrationSnapshot[] {
    return [...this.#registrations.values()].map((registration) => ({
      id: registration.wire.id,
      kind: registration.wire.kind,
      name: registration.wire.name,
      status: registration.status,
      ...(registration.error === undefined ? {} : { error: registration.error.message }),
    }));
  }

  public getRecentExecutions(): readonly ExecutionRecord[] {
    return this.#recentExecutions.map((record) => ({
      ...record,
      ...(record.error === undefined ? {} : { error: { ...record.error } }),
    }));
  }

  public getLogs(): readonly BrowserMCPLogEntry[] {
    return this.#logs.map((entry) => this.#cloneLogEntry(entry));
  }

  #addRegistration(
    registration: CapabilityRegistration,
    execute: InternalExecutor,
  ): RegistrationHandle {
    // Reuse protocol validation so local errors fail before any network mutation.
    const validated = createBridgeMessage(
      "register",
      { sessionId: "validation", registration },
      { id: "validation-message", timestamp: 0 },
    ).payload.registration;
    const internal: InternalRegistration = {
      wire: cloneJson(validated),
      execute,
      waiters: new Set(),
      status: "pending",
    };
    this.#registrations.set(validated.id, internal);
    this.#log("info", "registration.added", {
      registrationId: validated.id,
      kind: validated.kind,
      name: validated.name,
    });
    this.#emit();

    if (this.#connectionState === "connected") {
      void this.#registerWithBridge(internal).catch(() => undefined);
    }
    const owner = this;
    return {
      id: validated.id,
      get ready(): Promise<void> {
        return owner.#waitForRegistration(validated.id);
      },
      unregister: async (): Promise<void> => {
        await owner.unregister(validated.id);
      },
    };
  }

  #waitForRegistration(registrationId: string): Promise<void> {
    const registration = this.#registrations.get(registrationId);
    if (registration === undefined) {
      return Promise.reject(
        new BrowserMCPError("REGISTRATION_FAILED", "Registration no longer exists"),
      );
    }
    if (registration.status === "registered") return Promise.resolve();
    if (registration.status === "rejected") {
      return Promise.reject(
        registration.error ??
          new BrowserMCPError("REGISTRATION_FAILED", "Registration was rejected"),
      );
    }
    const waiter = deferred<void>();
    registration.waiters.add(waiter);
    return waiter.promise;
  }

  #beginConnect(options: ConnectOptions, reconnecting: boolean): Promise<BrowserMCPSessionInfo> {
    const attempt = this.#connectAttempt(options, reconnecting);
    this.#connectPromise = attempt;
    void attempt.then(
      () => {
        if (this.#connectPromise === attempt) this.#connectPromise = undefined;
      },
      () => {
        if (this.#connectPromise === attempt) this.#connectPromise = undefined;
      },
    );
    return attempt;
  }

  async #connectAttempt(
    options: ConnectOptions,
    reconnecting: boolean,
  ): Promise<BrowserMCPSessionInfo> {
    const controller = new AbortController();
    this.#connectAbort = controller;
    const abortFromCaller = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted === true) abortFromCaller();
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      return await this.#connectInternal({ ...options, signal: controller.signal }, reconnecting);
    } catch (cause) {
      const rawError = controller.signal.aborted
        ? controller.signal.reason instanceof BrowserMCPError
          ? controller.signal.reason
          : new BrowserMCPError("CONNECTION_CLOSED", "Connection attempt was cancelled", {
              cause: controller.signal.reason,
            })
        : cause instanceof BrowserMCPError
          ? cause
          : new BrowserMCPError("CONNECTION_FAILED", "BrowserMCP connection preparation failed", {
              cause,
            });
      const error = redactError(rawError);
      if (
        !this.#manualClose &&
        this.#connectionState !== "disconnected" &&
        (this.#lastError !== error || this.#connectionState !== "error")
      ) {
        this.#failConnection(error);
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      if (this.#connectAbort === controller) this.#connectAbort = undefined;
    }
  }

  async #connectInternal(
    connectOptions: ConnectOptions,
    reconnecting: boolean,
  ): Promise<BrowserMCPSessionInfo> {
    this.#lastError = undefined;
    this.#setState(reconnecting ? "reconnecting" : "connecting");
    const bridgeUrl = validateBridgeUrl(this.#options.bridgeUrl, this.#options.origin).toString();

    const lnaOption =
      connectOptions.prepareLocalNetworkAccess ?? this.#options.prepareLocalNetworkAccess;
    if (lnaOption !== false) {
      const lnaOptions = lnaOption === true ? {} : lnaOption;
      await this.prepareLocalNetworkAccess({
        ...lnaOptions,
        ...(connectOptions.signal === undefined ? {} : { signal: connectOptions.signal }),
      });
      this.#log("info", "connection.local_network_ready");
    }

    const auth = await this.#connectionAuth(
      connectOptions.token,
      connectOptions.requestApproval ?? !reconnecting,
    );
    if (connectOptions.signal?.aborted === true) {
      throw new BrowserMCPError("CONNECTION_CLOSED", "Connection attempt was cancelled");
    }

    let socket: WebSocketLike;
    try {
      socket = this.#options.webSocketFactory(bridgeUrl);
    } catch (cause) {
      const error =
        cause instanceof BrowserMCPError
          ? cause
          : new BrowserMCPError(
              "CONNECTION_FAILED",
              "Could not create the Bridge WebSocket. For wss:, verify that the loopback certificate is trusted.",
              { cause, retryable: true },
            );
      throw error;
    }
    const handshake = deferred<BrowserMCPSessionInfo>();
    this.#handshake = handshake;
    this.#socket = socket;
    const generation = ++this.#connectionGeneration;
    this.#manualClose = false;
    this.#suppressReconnectOnce = false;

    const onOpen = (): void => {
      try {
        const connect = createBridgeMessage("connect", {
          supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
          auth,
          app: this.#options.app,
          origin: this.#options.origin,
          runtime: {
            id: this.#options.runtimeId,
            instanceId: this.#options.instanceId,
            ...(globalThis.navigator?.userAgent === undefined
              ? {}
              : { userAgent: globalThis.navigator.userAgent }),
            ...(globalThis.navigator?.platform === undefined
              ? {}
              : { platform: globalThis.navigator.platform }),
            ...(globalThis.navigator?.language === undefined
              ? {}
              : { language: globalThis.navigator.language }),
          },
        });
        this.#connectMessageId = connect.id;
        this.#send(connect);
        this.#log("info", "connection.handshake_sent", { authKind: auth.kind });
      } catch (cause) {
        this.#suppressReconnectOnce = true;
        this.#failConnection(
          new BrowserMCPError("PROTOCOL_ERROR", "Could not create connect message", { cause }),
        );
        socket.close(1002, "Connect message failed");
      }
    };
    const onMessage = (event: WebSocketMessageEvent): void => {
      void this.#onSocketMessage(socket, generation, event).catch((cause) => {
        this.#protocolFailure("Failed while processing a Bridge message", cause);
      });
    };
    const onError = (): void => {
      this.#log("warn", "connection.websocket_error", {
        message: "WebSocket reported a transport error",
      });
    };
    const onClose = (event: WebSocketCloseEvent): void => {
      void this.#onSocketClose(socket, event);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);

    const onAbort = (): void => {
      this.#suppressReconnectOnce = true;
      const error =
        connectOptions.signal?.reason instanceof BrowserMCPError
          ? connectOptions.signal.reason
          : new BrowserMCPError("CONNECTION_CLOSED", "Connection attempt was cancelled");
      if (this.#manualClose) this.#handshake?.reject(error);
      else this.#failConnection(error);
      socket.close(1000, "Connection cancelled");
    };
    connectOptions.signal?.addEventListener("abort", onAbort, { once: true });
    this.#armConnectTimeout(
      socket,
      generation,
      this.#options.connectTimeoutMs,
      "Timed out while connecting to the BrowserMCP Bridge",
    );

    try {
      return await handshake.promise;
    } finally {
      connectOptions.signal?.removeEventListener("abort", onAbort);
      this.#clearConnectTimeout(generation);
      if (this.#handshake === handshake) this.#handshake = undefined;
    }
  }

  async #connectionAuth(
    explicitToken: string | undefined,
    requestApproval: boolean,
  ): Promise<ConnectionAuth> {
    // A constructor token is transitional input, not instance configuration. Consume it on the
    // first auth resolution even when a stored resume credential wins, so it cannot linger.
    const oneShotToken = this.#oneShotPairingToken;
    this.#oneShotPairingToken = undefined;
    const stored =
      this.#session === undefined
        ? await this.#loadStoredSession()
        : {
            session: this.#session,
            origin: this.#options.origin,
            runtimeId: this.#options.runtimeId,
            instanceId: this.#options.instanceId,
          };
    if (
      stored !== undefined &&
      stored.session.expiresAt > Date.now() &&
      stored.origin === this.#options.origin &&
      stored.runtimeId === this.#options.runtimeId &&
      stored.instanceId === this.#options.instanceId
    ) {
      this.#session = stored.session;
      return {
        kind: "resume",
        sessionId: stored.session.id,
        token: stored.session.resumeToken,
      };
    }
    if (stored !== undefined) await this.#clearStoredSession();

    const token = explicitToken ?? oneShotToken ?? (await this.#options.getToken?.());
    if (token === undefined || token === "") {
      if (requestApproval) return { kind: "approval" };
      throw new BrowserMCPError(
        "AUTH_REQUIRED",
        "A valid resume credential or an explicit operator approval request is required",
      );
    }
    return { kind: "pairing", token };
  }

  async #onSocketMessage(
    socket: WebSocketLike,
    generation: number,
    event: WebSocketMessageEvent,
  ): Promise<void> {
    if (socket !== this.#socket || generation !== this.#connectionGeneration) return;
    if (typeof event.data !== "string") {
      this.#protocolFailure("Bridge sent a non-text WebSocket message");
      return;
    }
    let message: BridgeMessage;
    try {
      message = parseBridgeMessage(event.data, {
        maxBytes: this.#limits?.maxMessageBytes,
      });
    } catch (cause) {
      this.#protocolFailure("Bridge sent an invalid protocol message", cause);
      return;
    }

    if (message.type === "error") {
      await this.#onRemoteError(message);
      return;
    }
    if (message.type === "approval_required") {
      this.#onApprovalRequired(socket, generation, message);
      return;
    }
    if (message.type === "welcome") {
      await this.#onWelcome(socket, generation, message);
      return;
    }
    if (this.#session === undefined || this.#connectionState !== "connected") {
      this.#protocolFailure(`Unexpected ${message.type} message before session establishment`);
      return;
    }
    if (
      "sessionId" in message.payload &&
      message.payload.sessionId !== undefined &&
      message.payload.sessionId !== this.#session.id
    ) {
      this.#protocolFailure("Bridge message sessionId does not match the active session");
      return;
    }

    if (message.replyTo !== undefined) {
      const pending = this.#pendingReplies.get(message.replyTo);
      if (pending !== undefined) {
        if (message.type !== pending.expectedType) {
          this.#protocolFailure(
            `Expected ${pending.expectedType} response, received ${message.type}`,
          );
          return;
        }
        if (
          (message.type === "registered" || message.type === "unregistered") &&
          message.payload.registrationId !== pending.registrationId
        ) {
          this.#protocolFailure(`${message.type} response referenced a different registrationId`);
          return;
        }
        clearTimeout(pending.timer);
        this.#pendingReplies.delete(message.replyTo);
        pending.resolve(message);
        return;
      }
    }

    switch (message.type) {
      case "invoke":
        void this.#executeInvocation(message).catch((cause) => {
          this.#log("warn", "invocation.transport_failure", {
            invocationId: message.payload.invocationId,
            message: safeMessage(cause, "Could not return the browser invocation result"),
          });
        });
        break;
      case "cancel":
        this.#cancelInvocation(message);
        break;
      case "ping":
        this.#send(
          createBridgeMessage(
            "pong",
            { sessionId: this.#session.id, nonce: message.payload.nonce },
            { replyTo: message.id },
          ),
        );
        break;
      case "pong":
        this.#log("debug", "connection.pong", { nonce: message.payload.nonce });
        break;
      case "disconnect":
        if (!message.payload.canResume) {
          this.#suppressReconnectOnce = true;
          try {
            await this.#clearStoredSession();
          } catch (cause) {
            this.#failConnection(
              this.#connectionFailure(cause, "Could not clear the session store"),
            );
          }
        }
        this.#socket?.close(1000, "Bridge disconnect");
        break;
      case "registered":
      case "unregistered":
        this.#protocolFailure(`Unmatched ${message.type} response`);
        break;
      case "connect":
      case "register":
      case "unregister":
      case "result":
        this.#protocolFailure(`Unexpected bridge-to-browser message ${message.type}`);
        break;
    }
  }

  #onApprovalRequired(
    socket: WebSocketLike,
    generation: number,
    message: BridgeMessageOfType<"approval_required">,
  ): void {
    const connectMessageId = this.#connectMessageId;
    if (
      this.#handshake === undefined ||
      connectMessageId === undefined ||
      message.replyTo !== connectMessageId ||
      message.payload.origin !== this.#options.origin ||
      this.#approval !== undefined ||
      (this.#connectionState !== "connecting" && this.#connectionState !== "reconnecting")
    ) {
      this.#protocolFailure("Origin approval response did not match the active connect request");
      return;
    }
    this.#approval = { ...message.payload };
    this.#setState("awaiting-approval");
    const remainingMs = Math.max(
      1,
      Math.min(this.#options.approvalTimeoutMs, message.payload.expiresAt - Date.now() + 1_000),
    );
    this.#armConnectTimeout(
      socket,
      generation,
      remainingMs,
      "Timed out while waiting for Bridge operator approval",
    );
    this.#log("info", "connection.approval_requested", {
      origin: message.payload.origin,
      requestId: message.payload.requestId,
      expiresAt: message.payload.expiresAt,
    });
  }

  async #onWelcome(
    socket: WebSocketLike,
    generation: number,
    message: BridgeMessageOfType<"welcome">,
  ): Promise<void> {
    const handshake = this.#handshake;
    const connectMessageId = this.#connectMessageId;
    if (
      handshake === undefined ||
      connectMessageId === undefined ||
      message.replyTo !== connectMessageId
    ) {
      this.#protocolFailure("Welcome did not match the active connect request");
      return;
    }
    if (
      !SUPPORTED_PROTOCOL_VERSIONS.includes(
        message.payload.selectedVersion as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number],
      ) ||
      message.version !== message.payload.selectedVersion
    ) {
      this.#protocolFailure("Bridge selected an unsupported protocol version");
      return;
    }
    const negotiated = new Set(message.payload.capabilities);
    if (
      negotiated.size !== KNOWN_PROTOCOL_CAPABILITIES.length ||
      KNOWN_PROTOCOL_CAPABILITIES.some((capability) => !negotiated.has(capability))
    ) {
      this.#protocolFailure(
        "Bridge did not negotiate the complete required BrowserMCP v1 capability set",
      );
      return;
    }
    try {
      await this.#saveStoredSession({
        session: { ...message.payload.session },
        origin: this.#options.origin,
        runtimeId: this.#options.runtimeId,
        instanceId: this.#options.instanceId,
      });
    } catch (cause) {
      if (!this.#isPendingHandshake(socket, generation, handshake, connectMessageId)) return;
      this.#suppressReconnectOnce = true;
      const error = this.#connectionFailure(cause, "Could not save the session store");
      const cleanup = this.#clearStoredSession().catch((clearCause) => {
        this.#log("warn", "session_store.cleanup_failed", {
          message: safeMessage(clearCause, "Session store cleanup failed"),
        });
      });
      this.#failConnection(error);
      if (socket === this.#socket && generation === this.#connectionGeneration) {
        socket.close(1011, "Session store failure");
      }
      await cleanup;
      return;
    }
    if (!this.#isPendingHandshake(socket, generation, handshake, connectMessageId)) return;
    this.#approval = undefined;
    this.#session = { ...message.payload.session };
    this.#limits = { ...message.payload.limits };
    this.#negotiatedCapabilities = [...message.payload.capabilities];
    this.#reconnectAttempt = 0;
    this.#setState("connected");
    this.#log("info", "connection.connected", {
      sessionId: this.#session.id,
      protocolVersion: message.payload.selectedVersion,
    });

    await Promise.allSettled(
      [...this.#registrations.values()].map((registration) =>
        this.#registerWithBridge(registration),
      ),
    );
    if (this.#isConnectedHandshake(socket, generation, handshake) && this.#session !== undefined) {
      handshake.resolve(publicSession(this.#session));
    }
  }

  async #onRemoteError(message: BridgeMessageOfType<"error">): Promise<void> {
    const error = new BrowserMCPRemoteError({
      protocolCode: message.payload.code,
      message: redactText(message.payload.message),
      retryable: message.payload.retryable,
      ...(message.payload.details === undefined
        ? {}
        : { details: redactJson(message.payload.details) }),
    });
    if (message.replyTo !== undefined) {
      if (message.replyTo === this.#connectMessageId && this.#handshake !== undefined) {
        if (message.payload.code === "SESSION_RESUME_REJECTED") {
          this.#suppressReconnectOnce = true;
          this.#failConnection(error);
          await this.#clearStoredSession();
          return;
        } else if (
          message.payload.code === "AUTH_INVALID" ||
          message.payload.code === "AUTH_EXPIRED" ||
          message.payload.code === "APPROVAL_REJECTED" ||
          message.payload.code === "APPROVAL_EXPIRED" ||
          message.payload.code === "ORIGIN_NOT_ALLOWED" ||
          message.payload.code === "VERSION_UNSUPPORTED"
        ) {
          this.#suppressReconnectOnce = true;
        }
        this.#failConnection(error);
        return;
      }
      const pending = this.#pendingReplies.get(message.replyTo);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.#pendingReplies.delete(message.replyTo);
        pending.reject(error);
        return;
      }
    }
    this.#lastError = error;
    this.#log("warn", "protocol.remote_error", {
      code: message.payload.code,
      message: error.message,
    });
    this.#emit();
  }

  async #registerWithBridge(registration: InternalRegistration): Promise<void> {
    if (
      this.#session === undefined ||
      this.#connectionState !== "connected" ||
      !this.#negotiatedCapabilities.includes(registrationCapability(registration.wire.kind))
    ) {
      const error = new BrowserMCPError(
        "CAPABILITY_NOT_NEGOTIATED",
        `Bridge did not negotiate ${registrationCapability(registration.wire.kind)}`,
      );
      this.#rejectRegistration(registration, error);
      throw error;
    }
    registration.status = "registering";
    registration.error = undefined;
    this.#emit();
    const message = createBridgeMessage("register", {
      sessionId: this.#session.id,
      registration: registration.wire,
    });
    try {
      const response = await this.#sendForReply(message, "registered");
      if (
        response.type !== "registered" ||
        response.payload.registrationId !== registration.wire.id
      ) {
        throw new BrowserMCPError(
          "PROTOCOL_ERROR",
          "Registration acknowledgement referenced the wrong registration",
        );
      }
      registration.status = "registered";
      for (const waiter of registration.waiters) waiter.resolve(undefined);
      registration.waiters.clear();
      this.#log("info", "registration.registered", {
        registrationId: registration.wire.id,
        kind: registration.wire.kind,
        name: registration.wire.name,
      });
      this.#emit();
    } catch (cause) {
      const error =
        cause instanceof BrowserMCPError
          ? cause
          : new BrowserMCPError("REGISTRATION_FAILED", "Bridge rejected registration", {
              cause,
            });
      this.#rejectRegistration(registration, error);
      throw error;
    }
  }

  #rejectRegistration(registration: InternalRegistration, error: BrowserMCPError): void {
    registration.status = "rejected";
    registration.error = error;
    for (const waiter of registration.waiters) waiter.reject(error);
    registration.waiters.clear();
    this.#log("warn", "registration.rejected", {
      registrationId: registration.wire.id,
      code: error.code,
      message: error.message,
    });
    this.#emit();
  }

  #sendForReply(
    message: BridgeMessageOfType<"register"> | BridgeMessageOfType<"unregister">,
    expectedType: PendingReply["expectedType"],
  ): Promise<BridgeMessage> {
    const timeoutMs = this.#limits?.requestTimeoutMs ?? this.#options.connectTimeoutMs;
    return new Promise<BridgeMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingReplies.delete(message.id);
        reject(
          new BrowserMCPError("REGISTRATION_FAILED", `Timed out waiting for ${expectedType}`, {
            retryable: true,
          }),
        );
      }, timeoutMs);
      const registrationId =
        message.type === "register"
          ? message.payload.registration.id
          : message.payload.registrationId;
      this.#pendingReplies.set(message.id, {
        expectedType,
        registrationId,
        resolve,
        reject,
        timer,
      });
      try {
        this.#send(message);
      } catch (error) {
        clearTimeout(timer);
        this.#pendingReplies.delete(message.id);
        reject(error);
      }
    });
  }

  async #executeInvocation(message: BridgeMessageOfType<"invoke">): Promise<void> {
    if (this.#session === undefined) return;
    if (this.#activeInvocations.has(message.payload.invocationId)) {
      this.#sendInvocationError(
        message.payload.invocationId,
        "INVALID_MESSAGE",
        "Duplicate invocationId",
      );
      return;
    }
    const registration = this.#registrations.get(message.payload.registrationId);
    if (registration === undefined || registration.status !== "registered") {
      this.#sendInvocationError(
        message.payload.invocationId,
        "REGISTRATION_NOT_FOUND",
        "Registration is not available",
      );
      return;
    }
    const concurrentLimit = this.#limits?.maxConcurrentInvocations ?? 1;
    if (this.#activeInvocations.size >= concurrentLimit) {
      this.#sendInvocationError(
        message.payload.invocationId,
        "RATE_LIMITED",
        "Browser runtime concurrent invocation limit reached",
        true,
      );
      return;
    }

    const startedAt = Date.now();
    const record: ExecutionRecord = {
      invocationId: message.payload.invocationId,
      registrationId: registration.wire.id,
      kind: registration.wire.kind,
      name: registration.wire.name,
      status: "running",
      startedAt,
    };
    this.#pushExecution(record);
    const controller = new AbortController();
    const timeoutMs = Math.min(
      message.payload.timeoutMs,
      this.#options.invocationTimeoutMs,
      this.#limits?.requestTimeoutMs ?? Number.POSITIVE_INFINITY,
    );
    const timer = setTimeout(() => {
      controller.abort(
        new BrowserMCPError("INVOCATION_TIMEOUT", "Browser capability execution timed out"),
      );
    }, timeoutMs);
    this.#activeInvocations.set(message.payload.invocationId, { controller, timer });
    const context: InvocationContext = {
      signal: controller.signal,
      invocationId: message.payload.invocationId,
      sessionId: this.#session.id,
      timeoutMs,
      log: (level, event, data): void => this.#log(level, `handler.${event}`, data),
    };

    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectFromAbort = (): void => {
        reject(
          controller.signal.reason instanceof BrowserMCPError
            ? controller.signal.reason
            : new BrowserMCPError(
                "INVOCATION_CANCELLED",
                "Browser capability execution was cancelled",
              ),
        );
      };
      if (controller.signal.aborted) rejectFromAbort();
      else controller.signal.addEventListener("abort", rejectFromAbort, { once: true });
    });

    try {
      const output = await Promise.race([
        registration.execute(message.payload.operation, context),
        abortPromise,
      ]);
      if (!this.#activeInvocations.has(message.payload.invocationId)) return;
      const durationMs = Date.now() - startedAt;
      this.#send(
        createBridgeMessage("result", {
          sessionId: this.#session.id,
          invocationId: message.payload.invocationId,
          output,
          durationMs,
        }),
      );
      this.#finishExecution(message.payload.invocationId, "success");
    } catch (cause) {
      if (!this.#activeInvocations.has(message.payload.invocationId)) return;
      if (cause instanceof BrowserMCPError && cause.code === "INVOCATION_TIMEOUT") {
        this.#finishExecution(message.payload.invocationId, "timeout", cause);
        this.#sendInvocationError(
          message.payload.invocationId,
          "INVOCATION_TIMEOUT",
          cause.message,
        );
      } else if (
        cause instanceof BrowserMCPError &&
        (cause.code === "INVOCATION_CANCELLED" || cause.code === "CONNECTION_CLOSED")
      ) {
        this.#finishExecution(message.payload.invocationId, "cancelled", cause);
        if (cause.code !== "CONNECTION_CLOSED") {
          this.#sendInvocationError(
            message.payload.invocationId,
            "INVOCATION_CANCELLED",
            cause.message,
          );
        }
      } else {
        const error = new BrowserMCPError(
          "HANDLER_ERROR",
          safeMessage(cause, "Capability handler failed"),
          { cause },
        );
        this.#finishExecution(message.payload.invocationId, "error", error);
        this.#sendInvocationError(message.payload.invocationId, "HANDLER_ERROR", error.message);
      }
    } finally {
      const active = this.#activeInvocations.get(message.payload.invocationId);
      if (active !== undefined) clearTimeout(active.timer);
      this.#activeInvocations.delete(message.payload.invocationId);
    }
  }

  #cancelInvocation(message: BridgeMessageOfType<"cancel">): void {
    const active = this.#activeInvocations.get(message.payload.invocationId);
    if (active === undefined) {
      this.#sendInvocationError(
        message.payload.invocationId,
        "INVOCATION_NOT_FOUND",
        "No matching invocation is running",
      );
      return;
    }
    active.controller.abort(
      new BrowserMCPError(
        "INVOCATION_CANCELLED",
        redactText(message.payload.reason ?? "Bridge cancelled the invocation"),
      ),
    );
  }

  #sendInvocationError(
    invocationId: string,
    code: string,
    message: string,
    retryable = false,
  ): void {
    if (this.#session === undefined) return;
    const safeErrorMessage = redactText(message);
    this.#send(
      createBridgeMessage("error", {
        sessionId: this.#session.id,
        invocationId,
        code,
        message: safeErrorMessage.trim() === "" ? "Browser invocation failed" : safeErrorMessage,
        retryable,
      }),
    );
  }

  #pushExecution(record: ExecutionRecord): void {
    this.#recentExecutions.unshift(record);
    this.#recentExecutions.splice(this.#options.maxRecentExecutions);
    this.#emit();
  }

  #finishExecution(
    invocationId: string,
    status: Exclude<ExecutionRecord["status"], "running">,
    error?: BrowserMCPError,
  ): void {
    const index = this.#recentExecutions.findIndex(
      (record) => record.invocationId === invocationId,
    );
    if (index < 0) return;
    const previous = this.#recentExecutions[index];
    if (previous === undefined) return;
    const finishedAt = Date.now();
    this.#recentExecutions[index] = {
      ...previous,
      status,
      finishedAt,
      durationMs: finishedAt - previous.startedAt,
      ...(error === undefined
        ? {}
        : { error: { code: error.code, message: redactText(error.message) } }),
    };
    this.#emit();
  }

  async #onSocketClose(socket: WebSocketLike, event: WebSocketCloseEvent): Promise<void> {
    if (socket !== this.#socket) return;
    this.#socket = undefined;
    this.#approval = undefined;
    const error = new BrowserMCPError(
      "CONNECTION_CLOSED",
      event.reason === ""
        ? `Bridge connection closed with code ${event.code}`
        : `Bridge connection closed: ${redactText(event.reason)}`,
      { retryable: true },
    );
    this.#rejectTransportWork(error);
    this.#log("warn", "connection.closed", {
      code: event.code,
      reason: redactText(event.reason),
    });
    if (this.#manualClose) {
      this.#setState("disconnected");
      return;
    }
    if (this.#suppressReconnectOnce) {
      this.#suppressReconnectOnce = false;
      this.#setState("error", this.#lastError ?? error);
      return;
    }
    this.#setState("disconnected", error);
    this.#scheduleReconnect();
  }

  #rejectTransportWork(error: BrowserMCPError): void {
    this.#handshake?.reject(error);
    for (const [id, pending] of this.#pendingReplies) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pendingReplies.delete(id);
    }
    for (const active of this.#activeInvocations.values()) {
      clearTimeout(active.timer);
      active.controller.abort(error);
    }
    for (const registration of this.#registrations.values()) {
      if (registration.status === "registered" || registration.status === "registering") {
        registration.status = "pending";
        registration.error = undefined;
      }
    }
    this.#emit();
  }

  #protocolFailure(message: string, cause?: unknown): void {
    const error = new BrowserMCPError("PROTOCOL_ERROR", message, { cause });
    this.#suppressReconnectOnce = true;
    this.#failConnection(error);
    this.#socket?.close(1002, "Protocol error");
  }

  #failConnection(error: BrowserMCPError): void {
    const safeError = redactError(error);
    this.#approval = undefined;
    this.#lastError = safeError;
    this.#handshake?.reject(safeError);
    this.#setState("error", safeError);
    this.#log("error", "connection.failed", {
      code: safeError.code,
      message: safeError.message,
    });
  }

  #scheduleReconnect(): void {
    const reconnect = this.#options.reconnect;
    if (
      reconnect === false ||
      this.#reconnectTimer !== undefined ||
      this.#reconnectAttempt >= reconnect.maxAttempts
    ) {
      return;
    }
    const delay = Math.min(
      reconnect.maxDelayMs,
      reconnect.initialDelayMs * reconnect.factor ** this.#reconnectAttempt,
    );
    this.#reconnectAttempt += 1;
    this.#setState("reconnecting");
    this.#log("info", "connection.reconnect_scheduled", {
      attempt: this.#reconnectAttempt,
      delayMs: delay,
    });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      const attempt = this.#beginConnect({}, true);
      void attempt.catch((cause) => {
        this.#log("warn", "connection.reconnect_failed", {
          attempt: this.#reconnectAttempt,
          message: safeMessage(cause, "Reconnect failed"),
        });
        if (this.#socket === undefined && cause instanceof BrowserMCPError && cause.retryable) {
          this.#scheduleReconnect();
        }
      });
    }, delay);
  }

  #cancelReconnect(): void {
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#reconnectAttempt = 0;
  }

  #closeAndWait(socket: WebSocketLike, code: number, reason: string): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeEventListener("close", onClose);
        resolve();
      };
      const onClose = (): void => finish();
      const timer = setTimeout(finish, 1_000);
      socket.addEventListener("close", onClose);
      try {
        socket.close(code, reason);
      } catch {
        finish();
      }
    });
  }

  #clearSessionMemory(): void {
    this.#session = undefined;
    this.#approval = undefined;
    this.#negotiatedCapabilities = [];
    this.#limits = undefined;
  }

  #connectionFailure(cause: unknown, message: string): BrowserMCPError {
    return cause instanceof BrowserMCPError
      ? cause
      : new BrowserMCPError("SESSION_STORE_FAILED", message, { cause });
  }

  #armConnectTimeout(
    socket: WebSocketLike,
    generation: number,
    timeoutMs: number,
    message: string,
  ): void {
    if (this.#connectTimer !== undefined) clearTimeout(this.#connectTimer.timer);
    const timer = setTimeout(() => {
      if (socket !== this.#socket || generation !== this.#connectionGeneration) return;
      const error = new BrowserMCPError("CONNECTION_TIMEOUT", message, { retryable: true });
      this.#failConnection(error);
      socket.close(1000, "Connection timeout");
    }, timeoutMs);
    this.#connectTimer = { generation, timer };
  }

  #clearConnectTimeout(generation: number): void {
    if (this.#connectTimer?.generation !== generation) return;
    clearTimeout(this.#connectTimer.timer);
    this.#connectTimer = undefined;
  }

  #isConnectedHandshake(
    socket: WebSocketLike,
    generation: number,
    handshake: Deferred<BrowserMCPSessionInfo>,
  ): boolean {
    return (
      socket === this.#socket &&
      generation === this.#connectionGeneration &&
      handshake === this.#handshake &&
      this.#connectionState === "connected"
    );
  }

  #isPendingHandshake(
    socket: WebSocketLike,
    generation: number,
    handshake: Deferred<BrowserMCPSessionInfo>,
    connectMessageId: string,
  ): boolean {
    return (
      socket === this.#socket &&
      generation === this.#connectionGeneration &&
      handshake === this.#handshake &&
      connectMessageId === this.#connectMessageId &&
      (this.#connectionState === "connecting" ||
        this.#connectionState === "reconnecting" ||
        this.#connectionState === "awaiting-approval")
    );
  }

  #runSessionStore<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#sessionStoreTail.then(operation);
    this.#sessionStoreTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #loadStoredSession(): Promise<StoredBrowserMCPSession | undefined> {
    try {
      return await this.#runSessionStore(
        async () => await this.#options.sessionStore.load(this.#options.app.id),
      );
    } catch (cause) {
      this.#clearSessionMemory();
      throw new BrowserMCPError("SESSION_STORE_FAILED", "Could not load the session store", {
        cause,
      });
    }
  }

  async #saveStoredSession(value: StoredBrowserMCPSession): Promise<void> {
    try {
      await this.#runSessionStore(
        async () => await this.#options.sessionStore.save(this.#options.app.id, value),
      );
    } catch (cause) {
      throw new BrowserMCPError("SESSION_STORE_FAILED", "Could not save the session store", {
        cause,
      });
    }
  }

  async #clearStoredSession(): Promise<void> {
    this.#clearSessionMemory();
    try {
      await this.#runSessionStore(
        async () => await this.#options.sessionStore.clear(this.#options.app.id),
      );
    } catch (cause) {
      throw new BrowserMCPError("SESSION_STORE_FAILED", "Could not clear the session store", {
        cause,
      });
    }
  }

  #send(message: BridgeMessage): void {
    const socket = this.#socket;
    if (socket === undefined || socket.readyState !== OPEN) {
      throw new BrowserMCPError(
        "CONNECTION_CLOSED",
        "Cannot send because the Bridge connection is not open",
        { retryable: true },
      );
    }
    const serialized = JSON.stringify(message);
    if (
      this.#limits !== undefined &&
      new TextEncoder().encode(serialized).byteLength > this.#limits.maxMessageBytes
    ) {
      throw new BrowserMCPError(
        "PROTOCOL_ERROR",
        "Outgoing protocol message exceeds the negotiated size limit",
      );
    }
    socket.send(serialized);
  }

  #setState(state: ConnectionState, error?: BrowserMCPError): void {
    this.#connectionState = state;
    if (error !== undefined) this.#lastError = redactError(error);
    this.#emit();
  }

  #log(
    level: BrowserMCPLogEntry["level"],
    event: string,
    data?: Readonly<Record<string, JsonValue>>,
  ): void {
    const redactedData =
      data === undefined
        ? undefined
        : (deepFreezeJson(redactJson(data as JsonValue)) as Readonly<Record<string, JsonValue>>);
    const entry: BrowserMCPLogEntry = Object.freeze({
      timestamp: Date.now(),
      level,
      event: redactText(event, 256),
      ...(redactedData === undefined ? {} : { data: redactedData }),
    });
    this.#logs.unshift(entry);
    this.#logs.splice(this.#options.maxLogEntries);
    try {
      this.#options.logger?.(this.#cloneLogEntry(entry));
    } catch {
      // Application logging must never affect protocol behavior.
    }
    this.#emit();
  }

  #cloneLogEntry(entry: BrowserMCPLogEntry): BrowserMCPLogEntry {
    const clonedData =
      entry.data === undefined
        ? undefined
        : (deepFreezeJson(cloneJson(entry.data) as JsonValue) as Readonly<
            Record<string, JsonValue>
          >);
    return Object.freeze({
      ...entry,
      ...(clonedData === undefined ? {} : { data: clonedData }),
    });
  }

  #emit(): void {
    if (this.#subscribers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const subscriber of this.#subscribers) {
      try {
        subscriber(snapshot);
      } catch {
        // A subscriber cannot break the runtime or other subscribers.
      }
    }
  }
}
