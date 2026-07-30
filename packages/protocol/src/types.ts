export const PROTOCOL_ID = "browsermcp.bridge" as const;
export const PROTOCOL_VERSION = "1.1.0" as const;
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION, "1.0.0"] as const;

export const KNOWN_PROTOCOL_CAPABILITIES = [
  "tools",
  "resources",
  "prompts",
  "cancellation",
  "session-resume",
  "heartbeat",
] as const;

export type KnownProtocolCapability = (typeof KNOWN_PROTOCOL_CAPABILITIES)[number];
export type ProtocolCapability = KnownProtocolCapability | (string & {});

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface AppIdentity {
  id: string;
  name: string;
  version: string;
}

export interface RuntimeIdentity {
  id: string;
  instanceId: string;
  userAgent?: string;
  platform?: string;
  language?: string;
}

export type ConnectionAuth =
  | { kind: "approval" }
  | { kind: "pairing"; token: string }
  | { kind: "resume"; sessionId: string; token: string };

export interface SessionInfo {
  id: string;
  resumeToken: string;
  expiresAt: number;
}

export interface ProtocolLimits {
  maxMessageBytes: number;
  maxConcurrentInvocations: number;
  requestTimeoutMs: number;
}

export interface ToolRegistration {
  kind: "tool";
  id: string;
  name: string;
  description?: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: JsonObject;
}

export interface ResourceRegistration {
  kind: "resource";
  id: string;
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
  annotations?: JsonObject;
}

export interface PromptArgumentDefinition {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptRegistration {
  kind: "prompt";
  id: string;
  name: string;
  description?: string;
  arguments?: PromptArgumentDefinition[];
  annotations?: JsonObject;
}

export type CapabilityRegistration = ToolRegistration | ResourceRegistration | PromptRegistration;

export interface ToolCallOperation {
  kind: "tool.call";
  arguments: JsonObject;
}

export interface ResourceReadOperation {
  kind: "resource.read";
  uri: string;
}

export interface PromptGetOperation {
  kind: "prompt.get";
  arguments?: Record<string, string>;
}

export type InvocationOperation = ToolCallOperation | ResourceReadOperation | PromptGetOperation;

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface AudioContent {
  type: "audio";
  data: string;
  mimeType: string;
}

export interface ResourceLinkContent {
  type: "resource_link";
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface EmbeddedResourceContent {
  type: "resource";
  resource: ResourceContents;
}

export type ProtocolContent =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLinkContent
  | EmbeddedResourceContent;

export type ResourceContents =
  | {
      uri: string;
      mimeType?: string;
      text: string;
    }
  | {
      uri: string;
      mimeType?: string;
      blob: string;
    };

export interface PromptMessage {
  role: "user" | "assistant";
  content: ProtocolContent;
}

export interface ToolInvocationResult {
  kind: "tool";
  content: ProtocolContent[];
  structuredContent?: JsonValue;
  isError?: boolean;
}

export interface ResourceInvocationResult {
  kind: "resource";
  contents: ResourceContents[];
}

export interface PromptInvocationResult {
  kind: "prompt";
  description?: string;
  messages: PromptMessage[];
}

export type InvocationResult =
  | ToolInvocationResult
  | ResourceInvocationResult
  | PromptInvocationResult;

export const KNOWN_PROTOCOL_ERROR_CODES = [
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_EXPIRED",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "ORIGIN_NOT_ALLOWED",
  "VERSION_UNSUPPORTED",
  "CAPABILITY_UNSUPPORTED",
  "INVALID_MESSAGE",
  "REGISTRATION_REJECTED",
  "REGISTRATION_NOT_FOUND",
  "INVOCATION_NOT_FOUND",
  "INVOCATION_TIMEOUT",
  "INVOCATION_CANCELLED",
  "HANDLER_ERROR",
  "SESSION_EXPIRED",
  "SESSION_RESUME_REJECTED",
  "RATE_LIMITED",
  "CONNECTION_CLOSED",
  "INTERNAL_ERROR",
] as const;

export type KnownProtocolErrorCode = (typeof KNOWN_PROTOCOL_ERROR_CODES)[number];
export type ProtocolErrorCode = KnownProtocolErrorCode | (string & {});

export interface MessagePayloads {
  connect: {
    supportedVersions: string[];
    capabilities: ProtocolCapability[];
    auth: ConnectionAuth;
    app: AppIdentity;
    origin: string;
    runtime: RuntimeIdentity;
  };
  approval_required: {
    requestId: string;
    origin: string;
    expiresAt: number;
  };
  welcome: {
    selectedVersion: string;
    capabilities: ProtocolCapability[];
    session: SessionInfo;
    limits: ProtocolLimits;
    heartbeatIntervalMs: number;
  };
  register: {
    sessionId: string;
    registration: CapabilityRegistration;
  };
  registered: {
    sessionId: string;
    registrationId: string;
  };
  unregister: {
    sessionId: string;
    registrationId: string;
  };
  unregistered: {
    sessionId: string;
    registrationId: string;
  };
  invoke: {
    sessionId: string;
    invocationId: string;
    registrationId: string;
    operation: InvocationOperation;
    timeoutMs: number;
  };
  result: {
    sessionId: string;
    invocationId: string;
    output: InvocationResult;
    durationMs?: number;
  };
  error: {
    sessionId?: string;
    invocationId?: string;
    code: ProtocolErrorCode;
    message: string;
    retryable: boolean;
    details?: JsonValue;
  };
  cancel: {
    sessionId: string;
    invocationId: string;
    reason?: string;
  };
  ping: {
    sessionId?: string;
    nonce: string;
  };
  pong: {
    sessionId?: string;
    nonce: string;
  };
  disconnect: {
    sessionId?: string;
    code: string;
    reason?: string;
    canResume: boolean;
  };
}

export type BridgeMessageType = keyof MessagePayloads;

export interface BridgeMessageBase<T extends BridgeMessageType> {
  protocol: typeof PROTOCOL_ID;
  version: string;
  id: string;
  type: T;
  timestamp: number;
  replyTo?: string;
  payload: MessagePayloads[T];
}

export type BridgeMessage = {
  [T in BridgeMessageType]: BridgeMessageBase<T>;
}[BridgeMessageType];

export type BridgeMessageOfType<T extends BridgeMessageType> = Extract<BridgeMessage, { type: T }>;

export interface CreateBridgeMessageOptions {
  id?: string;
  version?: string;
  timestamp?: number;
  replyTo?: string;
}
