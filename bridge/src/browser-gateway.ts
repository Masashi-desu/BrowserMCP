import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import {
  type BridgeMessage,
  type BridgeMessageOfType,
  type CapabilityRegistration,
  createBridgeMessage,
  type JsonValue,
  KNOWN_PROTOCOL_CAPABILITIES,
  negotiateCapabilities,
  negotiateProtocolVersion,
  PROTOCOL_VERSION,
  type ProtocolCapability,
  type ProtocolErrorCode,
  ProtocolValidationError,
  parseBridgeMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@browsermcp/protocol";
import WebSocket, { WebSocketServer } from "ws";

import type { InvocationBroker } from "./broker.js";
import type { BridgeLimits } from "./config.js";
import { BridgeError } from "./errors.js";
import { type RingLogger, safeText } from "./logger.js";
import type { AllowedOrigins } from "./origins.js";
import type { BrowserRegistration, BrowserSession, CapabilityRegistry } from "./registry.js";
import { normalizeWebOrigin, OneTimeTokenStore } from "./security.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_GRACE_MS = HEARTBEAT_INTERVAL_MS * 3;

export interface PairingGrant {
  readonly origin: string;
}

interface ResumeGrant {
  readonly appId: string;
  readonly instanceId: string;
  readonly origin: string;
  readonly runtimeId: string;
  readonly sessionId: string;
}

interface PendingApproval {
  readonly capabilities: ProtocolCapability[];
  readonly connectMessage: BridgeMessageOfType<"connect">;
  readonly expiresAt: number;
  readonly requestId: string;
  readonly requestedAt: number;
  readonly selectedVersion: string;
}

export interface PairingApprovalRequest {
  readonly app: BridgeMessageOfType<"connect">["payload"]["app"];
  readonly expiresAt: number;
  readonly origin: string;
  readonly requestId: string;
  readonly requestedAt: number;
  readonly runtime: BridgeMessageOfType<"connect">["payload"]["runtime"];
}

interface SocketState {
  readonly connectionId: string;
  readonly origin: string;
  readonly socket: WebSocket;
  handshakeTimer?: NodeJS.Timeout;
  lastSeenAt: number;
  pendingApproval?: PendingApproval;
  session?: BrowserSession;
}

function protocolError(error: unknown): { code: ProtocolErrorCode; message: string } {
  if (error instanceof ProtocolValidationError) {
    return {
      code: "INVALID_MESSAGE",
      message: `Invalid protocol message (${error.code})`,
    };
  }
  if (error instanceof BridgeError) {
    const code: ProtocolErrorCode =
      error.code === "REGISTRATION_CONFLICT" || error.code === "REGISTRATION_LIMIT"
        ? "REGISTRATION_REJECTED"
        : error.code === "NOT_FOUND"
          ? "REGISTRATION_NOT_FOUND"
          : error.code === "CONCURRENCY_LIMIT"
            ? "RATE_LIMITED"
            : "INVALID_MESSAGE";
    return { code, message: safeText(error.message, 512) };
  }
  return {
    code: "INVALID_MESSAGE",
    message: error instanceof Error ? safeText(error.message, 512) : "Invalid browser message",
  };
}

function asJsonDetails(value: unknown): JsonValue | undefined {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
}

export class BrowserGateway {
  readonly #broker: InvocationBroker;
  readonly #limits: BridgeLimits;
  readonly #logger: RingLogger;
  readonly #origins: AllowedOrigins;
  readonly #pairingTokens: OneTimeTokenStore<PairingGrant>;
  readonly #registry: CapabilityRegistry;
  readonly #resumeTokens: OneTimeTokenStore<ResumeGrant>;
  readonly #states = new Map<string, SocketState>();
  readonly #webSockets: WebSocketServer;
  readonly #heartbeat: NodeJS.Timeout;

  public constructor(options: {
    broker: InvocationBroker;
    limits: BridgeLimits;
    logger: RingLogger;
    origins: AllowedOrigins;
    registry: CapabilityRegistry;
  }) {
    this.#broker = options.broker;
    this.#limits = options.limits;
    this.#logger = options.logger;
    this.#origins = options.origins;
    this.#registry = options.registry;
    this.#pairingTokens = new OneTimeTokenStore("pair", options.limits.pairingTokenTtlMs);
    this.#resumeTokens = new OneTimeTokenStore("resume", options.limits.resumeTokenTtlMs);
    this.#webSockets = new WebSocketServer({
      clientTracking: true,
      maxPayload: options.limits.maxWebSocketPayloadBytes,
      noServer: true,
      perMessageDeflate: false,
    });
    this.#webSockets.on("connection", (socket, request) => this.accept(socket, request));
    this.#heartbeat = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    this.#heartbeat.unref();
  }

  public issuePairingToken(originValue: string): {
    expiresAt: number;
    origin: string;
    token: string;
  } {
    const origin = this.#origins.add(originValue);
    const issued = this.#pairingTokens.issue({ origin });
    this.#logger.info("Pairing token issued", { expiresAt: issued.expiresAt, origin });
    return { ...issued, origin };
  }

  public pendingApprovals(): readonly PairingApprovalRequest[] {
    return [...this.#states.values()]
      .flatMap((state) => {
        const pending = state.pendingApproval;
        if (pending === undefined) return [];
        return [
          {
            app: { ...pending.connectMessage.payload.app },
            expiresAt: pending.expiresAt,
            origin: state.origin,
            requestId: pending.requestId,
            requestedAt: pending.requestedAt,
            runtime: { ...pending.connectMessage.payload.runtime },
          },
        ];
      })
      .sort((left, right) => left.requestedAt - right.requestedAt);
  }

  public decidePairingApproval(requestId: string, decision: "approve" | "reject"): boolean {
    const state = [...this.#states.values()].find(
      (candidate) => candidate.pendingApproval?.requestId === requestId,
    );
    const pending = state?.pendingApproval;
    if (state === undefined || pending === undefined) return false;
    if (pending.expiresAt <= Date.now() || state.socket.readyState !== WebSocket.OPEN) {
      this.expirePairingApproval(state);
      return false;
    }
    state.pendingApproval = undefined;
    if (decision === "reject") {
      this.sendError(
        state,
        "APPROVAL_REJECTED",
        "The operator rejected this Origin connection request",
        pending.connectMessage.id,
        false,
      );
      state.socket.close(1008, "Origin approval rejected");
      this.#logger.info("Browser Origin approval rejected", {
        appId: pending.connectMessage.payload.app.id,
        origin: state.origin,
        requestId,
      });
      return true;
    }
    this.#origins.add(state.origin);
    this.establishSession(
      state,
      pending.connectMessage,
      pending.selectedVersion,
      pending.capabilities,
      randomUUID(),
    );
    this.#logger.info("Browser Origin approval accepted", {
      appId: pending.connectMessage.payload.app.id,
      origin: state.origin,
      requestId,
    });
    return true;
  }

  public handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
      this.rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/browser" || url.search !== "") {
      this.rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const origin = normalizeWebOrigin(request.headers.origin ?? "");
    if (!origin) {
      this.rejectUpgrade(socket, 403, "Origin not eligible");
      this.#logger.warn("Browser WebSocket origin rejected", { origin: request.headers.origin });
      return;
    }
    if (this.#states.size >= this.#limits.maxBrowserConnections) {
      this.rejectUpgrade(socket, 429, "Too Many Connections");
      return;
    }
    this.#webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      this.#webSockets.emit("connection", webSocket, request);
    });
  }

  public send(connectionId: string, message: ReturnType<typeof createBridgeMessage>): boolean {
    const state = this.#states.get(connectionId);
    if (!state || state.socket.readyState !== WebSocket.OPEN) return false;
    try {
      const payload = JSON.stringify(message);
      if (Buffer.byteLength(payload) > this.#limits.maxWebSocketPayloadBytes) {
        this.#logger.error("Bridge response exceeded WebSocket payload limit", {
          connectionId,
          type: message.type,
        });
        state.socket.close(1009, "Message too large");
        return false;
      }
      state.socket.send(payload);
      return true;
    } catch (error) {
      this.#logger.warn("Could not send browser protocol message", {
        connectionId,
        message: error instanceof Error ? safeText(error.message) : "WebSocket send failed",
        type: message.type,
      });
      return false;
    }
  }

  public async close(): Promise<void> {
    clearInterval(this.#heartbeat);
    for (const state of this.#states.values()) {
      this.send(
        state.connectionId,
        createBridgeMessage("disconnect", {
          ...(state.session ? { sessionId: state.session.sessionId } : {}),
          code: "BRIDGE_STOPPING",
          reason: "Bridge is stopping",
          canResume: false,
        }),
      );
      state.socket.close(1001, "Bridge stopping");
    }
    await new Promise<void>((resolve) => this.#webSockets.close(() => resolve()));
  }

  public get connectionCount(): number {
    return this.#states.size;
  }

  private accept(socket: WebSocket, request: IncomingMessage): void {
    const origin = normalizeWebOrigin(request.headers.origin ?? "");
    if (!origin) {
      socket.close(1008, "Origin required");
      return;
    }
    const connectionId = randomUUID();
    const state: SocketState = {
      connectionId,
      lastSeenAt: Date.now(),
      origin,
      socket,
    };
    state.handshakeTimer = setTimeout(() => {
      this.sendError(state, "AUTH_REQUIRED", "A connect message is required", undefined, false);
      socket.close(1008, "Handshake timeout");
    }, this.#limits.browserHandshakeTimeoutMs);
    state.handshakeTimer.unref();
    this.#states.set(connectionId, state);

    socket.on("message", (data, isBinary) => this.onRawMessage(state, data, isBinary));
    socket.on("error", (error) => {
      this.#logger.warn("Browser WebSocket error", { connectionId, message: error.message });
    });
    socket.on("close", () => this.onClose(state));
  }

  private onRawMessage(state: SocketState, data: WebSocket.RawData, isBinary: boolean): void {
    if (this.#states.get(state.connectionId) !== state) return;
    if (isBinary) {
      this.sendError(
        state,
        "INVALID_MESSAGE",
        "Binary messages are not supported",
        undefined,
        false,
      );
      state.socket.close(1008, "Text messages required");
      return;
    }
    try {
      const message = parseBridgeMessage(data.toString("utf8"), {
        allowUnsupportedVersion: state.session === undefined,
        maxBytes: this.#limits.maxWebSocketPayloadBytes,
      });
      state.lastSeenAt = Date.now();
      this.onMessage(state, message);
    } catch (error) {
      const converted = protocolError(error);
      this.sendError(state, converted.code, converted.message, undefined, false);
      state.socket.close(1008, "Invalid protocol message");
    }
  }

  private onMessage(state: SocketState, message: BridgeMessage): void {
    if (!state.session) {
      if (state.pendingApproval !== undefined) {
        throw new BridgeError("INVALID_MESSAGE", "This connection is awaiting operator approval");
      }
      if (message.type !== "connect") {
        throw new BridgeError("INVALID_MESSAGE", "The first message must be connect");
      }
      this.connect(state, message);
      return;
    }
    if (
      message.type === "connect" ||
      message.type === "approval_required" ||
      message.type === "welcome"
    ) {
      throw new BridgeError("INVALID_MESSAGE", `Unexpected ${message.type} message`);
    }
    if ("sessionId" in message.payload && message.payload.sessionId !== state.session.sessionId) {
      throw new BridgeError("INVALID_MESSAGE", "Message sessionId does not match this connection");
    }

    try {
      switch (message.type) {
        case "register":
          this.register(state, message);
          break;
        case "unregister":
          this.#registry.unregister(state.connectionId, message.payload.registrationId);
          this.send(
            state.connectionId,
            createBridgeMessage(
              "unregistered",
              {
                sessionId: state.session.sessionId,
                registrationId: message.payload.registrationId,
              },
              { replyTo: message.id },
            ),
          );
          break;
        case "result":
          if (
            !this.#broker.resolve(
              state.connectionId,
              message.payload.invocationId,
              message.payload.output,
            )
          ) {
            this.sendError(
              state,
              "INVOCATION_NOT_FOUND",
              "No matching pending invocation",
              message.id,
              false,
            );
          }
          break;
        case "error":
          if (
            !message.payload.invocationId ||
            !this.#broker.rejectFromBrowser(
              state.connectionId,
              message.payload.invocationId,
              message.payload.code,
              message.payload.message,
              message.payload.details,
            )
          ) {
            this.#logger.warn("Unmatched browser error", {
              code: message.payload.code,
              connectionId: state.connectionId,
            });
          }
          break;
        case "cancel":
          if (!this.#broker.cancelFromBrowser(state.connectionId, message.payload.invocationId)) {
            this.sendError(
              state,
              "INVOCATION_NOT_FOUND",
              "No matching pending invocation",
              message.id,
              false,
            );
          }
          break;
        case "ping":
          this.send(
            state.connectionId,
            createBridgeMessage(
              "pong",
              { sessionId: state.session.sessionId, nonce: message.payload.nonce },
              { replyTo: message.id },
            ),
          );
          break;
        case "pong":
          state.lastSeenAt = Date.now();
          break;
        case "disconnect":
          if (!message.payload.canResume) {
            this.#resumeTokens.revokeAll((grant) => grant.sessionId === state.session?.sessionId);
          }
          state.socket.close(1000, "Browser disconnected");
          break;
        case "invoke":
        case "registered":
        case "unregistered":
          throw new BridgeError("INVALID_MESSAGE", `Unexpected ${message.type} message`);
      }
    } catch (error) {
      const converted = protocolError(error);
      this.sendError(
        state,
        converted.code,
        converted.message,
        message.id,
        converted.code === "RATE_LIMITED",
        error instanceof BridgeError ? error.data : undefined,
      );
    }
  }

  private connect(state: SocketState, message: BridgeMessageOfType<"connect">): void {
    const payload = message.payload;
    const declaredOrigin = normalizeWebOrigin(payload.origin);
    if (!declaredOrigin || declaredOrigin !== state.origin) {
      this.sendError(
        state,
        "ORIGIN_NOT_ALLOWED",
        "Declared origin does not match the WebSocket Origin header",
        message.id,
        false,
      );
      state.socket.close(1008, "Origin mismatch");
      return;
    }

    let selectedVersion: string;
    let capabilities: ProtocolCapability[];
    try {
      if (!SUPPORTED_PROTOCOL_VERSIONS.includes(message.version as never)) {
        throw new Error(`Unsupported envelope protocol version '${message.version}'`);
      }
      const negotiatedVersion = negotiateProtocolVersion(payload.supportedVersions);
      if (!negotiatedVersion) throw new Error("No mutually supported protocol version");
      selectedVersion = negotiatedVersion;
      capabilities = negotiateCapabilities(payload.capabilities, KNOWN_PROTOCOL_CAPABILITIES);
    } catch (error) {
      this.sendError(
        state,
        "VERSION_UNSUPPORTED",
        error instanceof Error ? error.message : "No compatible protocol version",
        message.id,
        false,
      );
      state.socket.close(1002, "Unsupported protocol version");
      return;
    }
    const missingCapabilities = KNOWN_PROTOCOL_CAPABILITIES.filter(
      (capability) => !capabilities.includes(capability),
    );
    if (missingCapabilities.length > 0) {
      this.sendError(
        state,
        "CAPABILITY_UNSUPPORTED",
        `BrowserMCP protocol v1 requires: ${KNOWN_PROTOCOL_CAPABILITIES.join(", ")}`,
        message.id,
        false,
      );
      state.socket.close(1002, "Required capabilities missing");
      return;
    }

    if (payload.auth.kind === "approval") {
      if (selectedVersion === "1.0.0") {
        this.sendError(
          state,
          "VERSION_UNSUPPORTED",
          "Operator approval requires BrowserMCP Bridge Protocol 1.1 or newer",
          message.id,
          false,
        );
        state.socket.close(1002, "Approval protocol unsupported");
        return;
      }
      this.requestPairingApproval(state, message, selectedVersion, capabilities);
      return;
    }

    let sessionId: string = randomUUID();
    if (payload.auth.kind === "resume") {
      const resumeAuth = payload.auth;
      const grant = this.#resumeTokens.consumeIf(
        resumeAuth.token,
        (candidate) =>
          candidate.sessionId === resumeAuth.sessionId &&
          candidate.origin === state.origin &&
          candidate.appId === payload.app.id &&
          candidate.runtimeId === payload.runtime.id &&
          candidate.instanceId === payload.runtime.instanceId,
      );
      if (!grant) {
        this.rejectAuthentication(state, message.id, "Resume token is invalid or expired", true);
        return;
      }
      sessionId = grant.sessionId;
      this.retirePreviousConnectionForResume(state, grant);
    } else {
      const grant = this.#pairingTokens.consumeIf(
        payload.auth.token,
        (candidate) => candidate.origin === state.origin,
      );
      if (!grant) {
        this.rejectAuthentication(state, message.id, "Pairing token is invalid or expired");
        return;
      }
    }

    this.establishSession(state, message, selectedVersion, capabilities, sessionId);
  }

  private requestPairingApproval(
    state: SocketState,
    message: BridgeMessageOfType<"connect">,
    selectedVersion: string,
    capabilities: ProtocolCapability[],
  ): void {
    const pendingStates = [...this.#states.values()].filter(
      (candidate) => candidate.pendingApproval !== undefined,
    );
    const maxPending = Math.max(1, Math.floor(this.#limits.maxBrowserConnections / 2));
    const sameOrigin = pendingStates.filter((candidate) => candidate.origin === state.origin);
    const duplicate = sameOrigin.some((candidate) => {
      const payload = candidate.pendingApproval?.connectMessage.payload;
      return (
        payload?.app.id === message.payload.app.id &&
        payload.runtime.id === message.payload.runtime.id &&
        payload.runtime.instanceId === message.payload.runtime.instanceId
      );
    });
    if (pendingStates.length >= maxPending || sameOrigin.length >= 3 || duplicate) {
      this.sendError(
        state,
        "RATE_LIMITED",
        duplicate
          ? "An approval request for this browser runtime is already pending"
          : "Pending Origin approval limit reached",
        message.id,
        false,
      );
      state.socket.close(1008, "Approval request limit reached");
      return;
    }
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
    const requestedAt = Date.now();
    const pending: PendingApproval = {
      capabilities,
      connectMessage: message,
      expiresAt: requestedAt + this.#limits.pairingTokenTtlMs,
      requestId: randomUUID(),
      requestedAt,
      selectedVersion,
    };
    state.pendingApproval = pending;
    state.handshakeTimer = setTimeout(
      () => this.expirePairingApproval(state),
      this.#limits.pairingTokenTtlMs,
    );
    state.handshakeTimer.unref();
    if (
      !this.send(
        state.connectionId,
        createBridgeMessage(
          "approval_required",
          {
            requestId: pending.requestId,
            origin: state.origin,
            expiresAt: pending.expiresAt,
          },
          { replyTo: message.id, version: selectedVersion },
        ),
      )
    ) {
      state.socket.close(1011, "Could not create approval request");
      return;
    }
    this.#logger.info("Browser Origin approval requested", {
      appId: message.payload.app.id,
      origin: state.origin,
      requestId: pending.requestId,
      runtimeId: message.payload.runtime.id,
    });
  }

  private expirePairingApproval(state: SocketState): void {
    const pending = state.pendingApproval;
    if (pending === undefined) return;
    state.pendingApproval = undefined;
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
    state.handshakeTimer = undefined;
    this.sendError(
      state,
      "APPROVAL_EXPIRED",
      "The Origin approval request expired before an operator decision",
      pending.connectMessage.id,
      false,
    );
    state.socket.close(1008, "Origin approval expired");
    this.#logger.info("Browser Origin approval expired", {
      appId: pending.connectMessage.payload.app.id,
      origin: state.origin,
      requestId: pending.requestId,
    });
  }

  private establishSession(
    state: SocketState,
    message: BridgeMessageOfType<"connect">,
    selectedVersion: string,
    capabilities: ProtocolCapability[],
    sessionId: string,
  ): void {
    const payload = message.payload;

    const session: BrowserSession = {
      app: payload.app,
      capabilities,
      connectedAt: new Date().toISOString(),
      connectionId: state.connectionId,
      origin: state.origin,
      protocolVersion: selectedVersion,
      runtime: payload.runtime,
      sessionId,
    };
    try {
      this.#registry.addSession(session);
    } catch (error) {
      const converted = protocolError(error);
      this.sendError(state, converted.code, converted.message, message.id, false);
      state.socket.close(1008, "Runtime conflict");
      return;
    }
    state.session = session;
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
    state.handshakeTimer = undefined;

    this.#resumeTokens.revokeAll((grant) => grant.sessionId === sessionId);
    const resume = this.#resumeTokens.issue({
      appId: payload.app.id,
      instanceId: payload.runtime.instanceId,
      origin: state.origin,
      runtimeId: payload.runtime.id,
      sessionId,
    });
    this.send(
      state.connectionId,
      createBridgeMessage(
        "welcome",
        {
          selectedVersion,
          capabilities,
          session: { id: sessionId, resumeToken: resume.token, expiresAt: resume.expiresAt },
          limits: {
            maxMessageBytes: this.#limits.maxWebSocketPayloadBytes,
            maxConcurrentInvocations: this.#limits.maxConcurrentRequestsPerRuntime,
            requestTimeoutMs: this.#limits.browserRequestTimeoutMs,
          },
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        },
        { replyTo: message.id, version: selectedVersion },
      ),
    );
    this.#logger.info("Browser runtime connected", {
      appId: session.app.id,
      connectionId: session.connectionId,
      origin: session.origin,
      runtimeId: session.runtime.id,
    });
  }

  private retirePreviousConnectionForResume(state: SocketState, grant: ResumeGrant): void {
    const previous = [...this.#states.values()].find(
      (candidate) =>
        candidate !== state &&
        candidate.session?.sessionId === grant.sessionId &&
        candidate.session.origin === grant.origin &&
        candidate.session.app.id === grant.appId &&
        candidate.session.runtime.id === grant.runtimeId &&
        candidate.session.runtime.instanceId === grant.instanceId,
    );
    if (previous?.session === undefined) return;

    const previousSession = previous.session;
    this.send(
      previous.connectionId,
      createBridgeMessage("disconnect", {
        sessionId: previousSession.sessionId,
        code: "SESSION_REPLACED",
        reason: "The authenticated session resumed on a replacement connection",
        canResume: false,
      }),
    );
    this.#states.delete(previous.connectionId);
    this.#broker.disconnect(previous.connectionId);
    const removed = this.#registry.removeSession(previous.connectionId);
    previous.session = undefined;
    previous.socket.close(1000, "Session resumed on replacement connection");
    this.#logger.info("Replaced stale browser connection during authenticated resume", {
      appId: previousSession.app.id,
      connectionId: previous.connectionId,
      removedRegistrations: removed.length,
      sessionId: previousSession.sessionId,
    });
  }

  private register(state: SocketState, message: BridgeMessageOfType<"register">): void {
    const session = state.session;
    if (!session) throw new BridgeError("BROWSER_DISCONNECTED", "Session is not connected");
    if (!session.capabilities.includes(`${message.payload.registration.kind}s`)) {
      throw new BridgeError(
        "INVALID_MESSAGE",
        `The ${message.payload.registration.kind} capability was not negotiated`,
      );
    }
    this.#registry.register(
      state.connectionId,
      message.payload.registration as CapabilityRegistration as BrowserRegistration,
    );
    this.send(
      state.connectionId,
      createBridgeMessage(
        "registered",
        {
          sessionId: session.sessionId,
          registrationId: message.payload.registration.id,
        },
        { replyTo: message.id },
      ),
    );
  }

  private rejectAuthentication(
    state: SocketState,
    replyTo: string,
    reason: string,
    resume = false,
  ): void {
    this.sendError(
      state,
      resume ? "SESSION_RESUME_REJECTED" : "AUTH_INVALID",
      reason,
      replyTo,
      false,
    );
    state.socket.close(1008, "Authentication failed");
  }

  private sendError(
    state: SocketState,
    code: ProtocolErrorCode,
    message: string,
    replyTo: string | undefined,
    retryable: boolean,
    details?: unknown,
  ): boolean {
    try {
      const jsonDetails = asJsonDetails(details);
      return this.send(
        state.connectionId,
        createBridgeMessage(
          "error",
          {
            ...(state.session ? { sessionId: state.session.sessionId } : {}),
            code,
            message: safeText(message, 512) || "Protocol request rejected",
            retryable,
            ...(jsonDetails === undefined ? {} : { details: jsonDetails }),
          },
          {
            ...(replyTo ? { replyTo } : {}),
            version: state.session?.protocolVersion ?? PROTOCOL_VERSION,
          },
        ),
      );
    } catch (error) {
      this.#logger.warn("Could not construct browser protocol error", {
        code,
        connectionId: state.connectionId,
        message: error instanceof Error ? safeText(error.message) : "Error construction failed",
      });
      try {
        return this.send(
          state.connectionId,
          createBridgeMessage("error", {
            code: "INVALID_MESSAGE",
            message: "Protocol request rejected",
            retryable: false,
          }),
        );
      } catch {
        return false;
      }
    }
  }

  private onClose(state: SocketState): void {
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
    this.#states.delete(state.connectionId);
    this.#broker.disconnect(state.connectionId);
    const removed = this.#registry.removeSession(state.connectionId);
    if (state.session) {
      this.#logger.info("Browser runtime disconnected", {
        appId: state.session.app.id,
        connectionId: state.connectionId,
        removedRegistrations: removed.length,
      });
    }
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const state of this.#states.values()) {
      if (!state.session) continue;
      if (now - state.lastSeenAt > HEARTBEAT_GRACE_MS) {
        state.socket.close(1001, "Heartbeat timeout");
        continue;
      }
      this.send(
        state.connectionId,
        createBridgeMessage("ping", {
          sessionId: state.session.sessionId,
          nonce: randomUUID(),
        }),
      );
    }
  }

  private rejectUpgrade(socket: Duplex, status: number, message: string): void {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}
