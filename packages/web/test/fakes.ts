import {
  type BridgeMessage,
  type BridgeMessageOfType,
  createBridgeMessage,
  PROTOCOL_VERSION,
  type ProtocolCapability,
  parseBridgeMessage,
} from "@browsermcp/protocol";

import type { WebSocketCloseEvent, WebSocketFactory, WebSocketLike } from "../src/index.js";

type Listener = (event: unknown) => void;

export class FakeWebSocket {
  public readyState = 0;
  public readonly sent: string[] = [];
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #onSend: (socket: FakeWebSocket, message: BridgeMessage) => void;

  public constructor(onSend: (socket: FakeWebSocket, message: BridgeMessage) => void) {
    this.#onSend = onSend;
  }

  public addEventListener(type: string, listener: Listener): void {
    const listeners = this.#listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: Listener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public send(data: string): void {
    if (this.readyState !== 1) throw new Error("Socket is not open");
    this.sent.push(data);
    this.#onSend(this, parseBridgeMessage(data));
  }

  public close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.#emit("close", { code, reason, wasClean: code === 1000 } satisfies WebSocketCloseEvent);
  }

  public open(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.#emit("open", { type: "open" });
  }

  public receive(message: BridgeMessage | string): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    this.#emit("message", { data });
  }

  public messages(): BridgeMessage[] {
    return this.sent.map((entry) => parseBridgeMessage(entry));
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

export interface FakeBridgeOptions {
  readonly capabilities?: readonly ProtocolCapability[];
  readonly selectedVersion?: string;
  readonly autoOpen?: boolean;
  readonly acknowledgeRegistrations?: boolean;
  readonly rejectUnregistrations?: boolean;
  readonly rejectResume?: boolean;
  readonly sessionTtlMs?: number;
  readonly wrongRegisteredId?: boolean;
  readonly wrongUnregisteredId?: boolean;
  readonly throwOnDisconnectSendOnce?: boolean;
  readonly deferApproval?: boolean;
}

export class FakeBridge {
  public readonly sockets: FakeWebSocket[] = [];
  public readonly received: BridgeMessage[] = [];
  public readonly factory: WebSocketFactory;
  public lastUrl: string | undefined;
  readonly #options: Required<FakeBridgeOptions>;
  #sessionSequence = 0;
  #throwOnDisconnectSend: boolean;
  #pendingApproval:
    | { readonly socket: FakeWebSocket; readonly message: BridgeMessageOfType<"connect"> }
    | undefined;

  public constructor(options: FakeBridgeOptions = {}) {
    this.#options = {
      capabilities: options.capabilities ?? [
        "tools",
        "resources",
        "prompts",
        "cancellation",
        "session-resume",
        "heartbeat",
      ],
      selectedVersion: options.selectedVersion ?? PROTOCOL_VERSION,
      autoOpen: options.autoOpen ?? true,
      acknowledgeRegistrations: options.acknowledgeRegistrations ?? true,
      rejectUnregistrations: options.rejectUnregistrations ?? false,
      rejectResume: options.rejectResume ?? false,
      sessionTtlMs: options.sessionTtlMs ?? 60_000,
      wrongRegisteredId: options.wrongRegisteredId ?? false,
      wrongUnregisteredId: options.wrongUnregisteredId ?? false,
      throwOnDisconnectSendOnce: options.throwOnDisconnectSendOnce ?? false,
      deferApproval: options.deferApproval ?? false,
    };
    this.#throwOnDisconnectSend = this.#options.throwOnDisconnectSendOnce;
    this.factory = (url): WebSocketLike => {
      this.lastUrl = url;
      const socket = new FakeWebSocket((sender, message) => this.#receive(sender, message));
      this.sockets.push(socket);
      if (this.#options.autoOpen) queueMicrotask(() => socket.open());
      return socket as unknown as WebSocketLike;
    };
  }

  public get socket(): FakeWebSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) throw new Error("No fake socket exists");
    return socket;
  }

  public connectMessages(): BridgeMessageOfType<"connect">[] {
    return this.received.filter(
      (message): message is BridgeMessageOfType<"connect"> => message.type === "connect",
    );
  }

  public approvePending(): void {
    const pending = this.#pendingApproval;
    if (pending === undefined) throw new Error("No approval request is pending");
    this.#pendingApproval = undefined;
    this.#welcome(pending.socket, pending.message);
  }

  public sendInvoke(options: {
    registrationId: string;
    invocationId?: string;
    operation: BridgeMessageOfType<"invoke">["payload"]["operation"];
    timeoutMs?: number;
  }): string {
    const invocationId = options.invocationId ?? `invocation-${Date.now()}`;
    this.socket.receive(
      createBridgeMessage("invoke", {
        sessionId: this.currentSessionId(),
        invocationId,
        registrationId: options.registrationId,
        operation: options.operation,
        timeoutMs: options.timeoutMs ?? 30_000,
      }),
    );
    return invocationId;
  }

  public currentSessionId(): string {
    const welcome = [...this.socket.messages()]
      .reverse()
      .find((message) => message.type === "connect");
    const connect = welcome ?? this.connectMessages().at(-1);
    if (connect?.type !== "connect") throw new Error("No connected session");
    const auth = connect.payload.auth;
    return auth.kind === "resume" ? auth.sessionId : `session-${this.#sessionSequence}`;
  }

  #receive(socket: FakeWebSocket, message: BridgeMessage): void {
    this.received.push(message);
    if (message.type === "disconnect" && this.#throwOnDisconnectSend) {
      this.#throwOnDisconnectSend = false;
      throw new Error("Synthetic OPEN-socket send failure");
    }
    if (message.type === "connect") {
      if (message.payload.auth.kind === "resume" && this.#options.rejectResume) {
        queueMicrotask(() => {
          socket.receive(
            createBridgeMessage(
              "error",
              {
                code: "SESSION_RESUME_REJECTED",
                message: "Resume credential rejected for test",
                retryable: false,
              },
              { replyTo: message.id },
            ),
          );
          queueMicrotask(() => socket.close(1008, "Resume rejected"));
        });
        return;
      }
      if (message.payload.auth.kind === "approval") {
        this.#pendingApproval = { socket, message };
        queueMicrotask(() => {
          socket.receive(
            createBridgeMessage(
              "approval_required",
              {
                requestId: `approval-${this.#sessionSequence + 1}`,
                origin: message.payload.origin,
                expiresAt: Date.now() + 120_000,
              },
              { replyTo: message.id },
            ),
          );
          if (!this.#options.deferApproval) this.approvePending();
        });
        return;
      }
      this.#welcome(socket, message);
    } else if (message.type === "register" && this.#options.acknowledgeRegistrations) {
      queueMicrotask(() =>
        socket.receive(
          createBridgeMessage(
            "registered",
            {
              sessionId: message.payload.sessionId,
              registrationId: this.#options.wrongRegisteredId
                ? `${message.payload.registration.id}:wrong`
                : message.payload.registration.id,
            },
            { replyTo: message.id },
          ),
        ),
      );
    } else if (message.type === "unregister") {
      queueMicrotask(() =>
        socket.receive(
          this.#options.rejectUnregistrations
            ? createBridgeMessage(
                "error",
                {
                  sessionId: message.payload.sessionId,
                  code: "REGISTRATION_REJECTED",
                  message: "Removal rejected for test",
                  retryable: false,
                },
                { replyTo: message.id },
              )
            : createBridgeMessage(
                "unregistered",
                {
                  sessionId: message.payload.sessionId,
                  registrationId: this.#options.wrongUnregisteredId
                    ? `${message.payload.registrationId}:wrong`
                    : message.payload.registrationId,
                },
                { replyTo: message.id },
              ),
        ),
      );
    }
  }

  #welcome(socket: FakeWebSocket, message: BridgeMessageOfType<"connect">): void {
    this.#sessionSequence += 1;
    const sessionId =
      message.payload.auth.kind === "resume"
        ? message.payload.auth.sessionId
        : `session-${this.#sessionSequence}`;
    queueMicrotask(() =>
      socket.receive(
        createBridgeMessage(
          "welcome",
          {
            selectedVersion: this.#options.selectedVersion,
            capabilities: [...this.#options.capabilities],
            session: {
              id: sessionId,
              resumeToken: `resume-token-${this.#sessionSequence.toString().padStart(16, "0")}`,
              expiresAt: Date.now() + this.#options.sessionTtlMs,
            },
            limits: {
              maxMessageBytes: 1_048_576,
              maxConcurrentInvocations: 8,
              requestTimeoutMs: 30_000,
            },
            heartbeatIntervalMs: 15_000,
          },
          {
            replyTo: message.id,
            version: this.#options.selectedVersion === "1.0.0" ? "1.0.0" : PROTOCOL_VERSION,
          },
        ),
      ),
    );
  }
}
