import type {
  AppIdentity,
  CapabilityRegistration,
  JsonObject,
  JsonValue,
  PromptArgumentDefinition,
  PromptInvocationResult,
  ProtocolCapability,
  ProtocolLimits,
  ResourceInvocationResult,
  SessionInfo,
  ToolInvocationResult,
} from "@browsermcp/protocol";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "awaiting-approval"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "disconnected"
  | "error";

export type RegistrationStatus = "pending" | "registering" | "registered" | "rejected";

export type ExecutionStatus = "running" | "success" | "error" | "timeout" | "cancelled";

export interface BrowserMCPLogEntry {
  readonly timestamp: number;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly data?: Readonly<Record<string, JsonValue>>;
}

export interface ExecutionRecord {
  readonly invocationId: string;
  readonly registrationId: string;
  readonly kind: CapabilityRegistration["kind"];
  readonly name: string;
  readonly status: ExecutionStatus;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface RegistrationSnapshot {
  readonly id: string;
  readonly kind: CapabilityRegistration["kind"];
  readonly name: string;
  readonly status: RegistrationStatus;
  readonly error?: string;
}

export interface BrowserMCPSnapshot {
  readonly app: AppIdentity;
  readonly connectionState: ConnectionState;
  readonly approval?: {
    readonly requestId: string;
    readonly origin: string;
    readonly expiresAt: number;
  };
  readonly session?: BrowserMCPSessionInfo;
  readonly negotiatedCapabilities: readonly ProtocolCapability[];
  readonly limits?: Readonly<ProtocolLimits>;
  readonly registrations: readonly RegistrationSnapshot[];
  readonly recentExecutions: readonly ExecutionRecord[];
  readonly lastError?: {
    readonly code: string;
    readonly message: string;
  };
  readonly reconnectAttempt: number;
}

export interface BrowserMCPSessionInfo {
  readonly id: string;
  readonly expiresAt: number;
}

export interface InvocationContext {
  readonly signal: AbortSignal;
  readonly invocationId: string;
  readonly sessionId: string;
  readonly timeoutMs: number;
  log(
    level: BrowserMCPLogEntry["level"],
    event: string,
    data?: Readonly<Record<string, JsonValue>>,
  ): void;
}

export type ToolHandlerResult = Omit<ToolInvocationResult, "kind">;
export type ResourceHandlerResult = Omit<ResourceInvocationResult, "kind">;
export type PromptHandlerResult = Omit<PromptInvocationResult, "kind">;

export interface WebToolDefinition<TArguments extends JsonObject = JsonObject> {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly annotations?: JsonObject;
  readonly handler: (
    arguments_: TArguments,
    context: InvocationContext,
  ) => ToolHandlerResult | Promise<ToolHandlerResult>;
}

export interface WebResourceDefinition {
  readonly name: string;
  readonly uri: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly annotations?: JsonObject;
  readonly handler: (
    request: { readonly uri: string },
    context: InvocationContext,
  ) => ResourceHandlerResult | Promise<ResourceHandlerResult>;
}

export interface WebPromptDefinition {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly PromptArgumentDefinition[];
  readonly annotations?: JsonObject;
  readonly handler: (
    arguments_: Readonly<Record<string, string>>,
    context: InvocationContext,
  ) => PromptHandlerResult | Promise<PromptHandlerResult>;
}

export interface RegistrationHandle {
  readonly id: string;
  readonly ready: Promise<void>;
  unregister(): Promise<void>;
}

export interface StoredBrowserMCPSession {
  readonly session: SessionInfo;
  readonly origin: string;
  readonly runtimeId: string;
  readonly instanceId: string;
}

export interface BrowserMCPSessionStore {
  load(
    appId: string,
  ): StoredBrowserMCPSession | undefined | Promise<StoredBrowserMCPSession | undefined>;
  save(appId: string, session: StoredBrowserMCPSession): void | Promise<void>;
  clear(appId: string): void | Promise<void>;
}

export interface WebSocketOpenEvent {
  readonly type?: string;
}

export interface WebSocketMessageEvent {
  readonly data: unknown;
}

export interface WebSocketCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean?: boolean;
}

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: (event: WebSocketOpenEvent) => void): void;
  addEventListener(type: "message", listener: (event: WebSocketMessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "close", listener: (event: WebSocketCloseEvent) => void): void;
  removeEventListener(type: "open", listener: (event: WebSocketOpenEvent) => void): void;
  removeEventListener(type: "message", listener: (event: WebSocketMessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: unknown) => void): void;
  removeEventListener(type: "close", listener: (event: WebSocketCloseEvent) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ReconnectOptions {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly factor?: number;
}

export interface LocalNetworkAccessOptions {
  readonly healthUrl?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Explicit page Origin for non-DOM callers. BrowserMCP instances always supply their Origin. */
  readonly pageOrigin?: string;
}

export interface LocalNetworkAccessResult {
  readonly url: string;
  readonly status: number;
}

export interface BrowserMCPOptions {
  readonly name: string;
  readonly version: string;
  readonly appId?: string;
  readonly bridgeUrl?: string;
  /** A short-lived pairing token. It is sent in the first protocol message, never in the URL. */
  readonly token?: string;
  readonly getToken?: () => string | Promise<string>;
  readonly origin?: string;
  readonly runtimeId?: string;
  readonly instanceId?: string;
  readonly webSocketFactory?: WebSocketFactory;
  readonly reconnect?: false | ReconnectOptions;
  readonly connectTimeoutMs?: number;
  /** Maximum time to keep a browser-initiated Origin approval request open. */
  readonly approvalTimeoutMs?: number;
  readonly invocationTimeoutMs?: number;
  readonly maxRecentExecutions?: number;
  readonly maxLogEntries?: number;
  readonly logger?: (entry: BrowserMCPLogEntry) => void;
  readonly sessionStore?: BrowserMCPSessionStore;
  readonly prepareLocalNetworkAccess?: boolean | LocalNetworkAccessOptions;
}

export interface ConnectOptions {
  readonly token?: string;
  /** Request an operator decision when no resume credential or legacy token is available. */
  readonly requestApproval?: boolean;
  readonly signal?: AbortSignal;
  readonly prepareLocalNetworkAccess?: boolean | LocalNetworkAccessOptions;
}

export interface DisconnectOptions {
  readonly reason?: string;
  /** Preserve the resume credential for a deliberate transport restart. */
  readonly preserveSession?: boolean;
}

export type BrowserMCPSubscriber = (snapshot: BrowserMCPSnapshot) => void;
