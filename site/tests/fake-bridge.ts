import {
  type BridgeMessage,
  type BridgeMessageOfType,
  createBridgeMessage,
  parseBridgeMessage,
  PROTOCOL_VERSION,
} from "@browsermcp/protocol";
import type { WebSocketCloseEvent, WebSocketFactory, WebSocketLike } from "@browsermcp/web";

type Listener = (event: unknown) => void;

class FakeSocket implements WebSocketLike {
  public readyState = 0;
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #onSend: (message: BridgeMessage) => void;

  public constructor(onSend: (message: BridgeMessage) => void) {
    this.#onSend = onSend;
  }

  public send(data: string): void {
    this.#onSend(parseBridgeMessage(data));
  }

  public close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.#emit("close", { code, reason, wasClean: code === 1000 } satisfies WebSocketCloseEvent);
  }

  public addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: never) => void,
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: never) => void,
  ): void {
    this.#listeners.get(type)?.delete(listener as Listener);
  }

  public open(): void {
    this.readyState = 1;
    this.#emit("open", { type: "open" });
  }

  public receive(message: BridgeMessage): void {
    this.#emit("message", { data: JSON.stringify(message) });
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

export class SiteFakeBridge {
  public readonly received: BridgeMessage[] = [];
  public readonly factory: WebSocketFactory;
  #socket: FakeSocket | undefined;
  #sessionId = "";

  public constructor() {
    this.factory = (): WebSocketLike => {
      const socket = new FakeSocket((message) => this.#receive(socket, message));
      this.#socket = socket;
      queueMicrotask(() => socket.open());
      return socket;
    };
  }

  public sendInvoke(options: {
    readonly registrationId: string;
    readonly invocationId: string;
    readonly operation: BridgeMessageOfType<"invoke">["payload"]["operation"];
  }): void {
    this.#socket?.receive(
      createBridgeMessage("invoke", {
        sessionId: this.#sessionId,
        invocationId: options.invocationId,
        registrationId: options.registrationId,
        operation: options.operation,
        timeoutMs: 30_000,
      }),
    );
  }

  #receive(socket: FakeSocket, message: BridgeMessage): void {
    this.received.push(message);
    if (message.type === "connect") {
      this.#sessionId = "site-integration-session";
      if (message.payload.auth.kind === "approval") {
        queueMicrotask(() => {
          socket.receive(
            createBridgeMessage(
              "approval_required",
              {
                requestId: "site-integration-approval",
                origin: message.payload.origin,
                expiresAt: Date.now() + 60_000,
              },
              { replyTo: message.id },
            ),
          );
          queueMicrotask(() => this.#welcome(socket, message));
        });
      } else {
        queueMicrotask(() => this.#welcome(socket, message));
      }
      return;
    }
    if (message.type === "register") {
      queueMicrotask(() =>
        socket.receive(
          createBridgeMessage(
            "registered",
            {
              sessionId: this.#sessionId,
              registrationId: message.payload.registration.id,
            },
            { replyTo: message.id },
          ),
        ),
      );
    }
  }

  #welcome(socket: FakeSocket, message: BridgeMessageOfType<"connect">): void {
    socket.receive(
      createBridgeMessage(
        "welcome",
        {
          selectedVersion: PROTOCOL_VERSION,
          capabilities: [
            "tools",
            "resources",
            "prompts",
            "cancellation",
            "session-resume",
            "heartbeat",
          ],
          session: {
            id: this.#sessionId,
            resumeToken: "resume-token-site-integration-1234",
            expiresAt: Date.now() + 60_000,
          },
          limits: {
            maxMessageBytes: 1_048_576,
            maxConcurrentInvocations: 8,
            requestTimeoutMs: 30_000,
          },
          heartbeatIntervalMs: 15_000,
        },
        { replyTo: message.id },
      ),
    );
  }
}
