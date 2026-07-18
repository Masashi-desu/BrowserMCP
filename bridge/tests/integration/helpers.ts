import {
  type BridgeMessage,
  type BridgeMessageOfType,
  type CapabilityRegistration,
  type ConnectionAuth,
  createBridgeMessage,
  PROTOCOL_VERSION,
  parseBridgeMessage,
} from "@browsermcp/protocol";
import WebSocket from "ws";

import { type BridgeConfig, DEFAULT_LIMITS, LOOPBACK_HOST } from "../../src/config.js";

export const MCP_TOKEN = `bmp_mcp_${"m".repeat(43)}`;
export const ADMIN_TOKEN = `bmp_admin_${"a".repeat(43)}`;

export function testConfig(
  options: Partial<BridgeConfig> & { allowedOrigins?: readonly string[] } = {},
): BridgeConfig {
  return {
    host: LOOPBACK_HOST,
    port: 0,
    allowedOrigins: options.allowedOrigins ?? [],
    limits: {
      ...DEFAULT_LIMITS,
      browserHandshakeTimeoutMs: 500,
      browserRequestTimeoutMs: 500,
      ...(options.limits ?? {}),
    },
    mcpBearerToken: MCP_TOKEN,
    adminBearerToken: ADMIN_TOKEN,
    ...(options.tls ? { tls: options.tls } : {}),
  };
}

interface Waiter {
  readonly resolve: (message: BridgeMessage) => void;
  readonly type: BridgeMessage["type"];
}

export class BrowserPeer {
  readonly #messages: BridgeMessage[] = [];
  readonly #waiters: Waiter[] = [];
  readonly app = { id: "test-app", name: "Test App", version: "1.0.0" };
  readonly runtime = { id: "runtime-1", instanceId: "tab-1", userAgent: "vitest" };
  readonly socket: WebSocket;
  readonly origin: string;

  public constructor(endpoint: string, origin: string) {
    this.origin = origin;
    this.socket = new WebSocket(endpoint, { origin });
    this.socket.on("message", (data) => {
      const message = parseBridgeMessage(data.toString());
      const index = this.#waiters.findIndex(({ type }) => type === message.type);
      const waiter = index >= 0 ? this.#waiters.splice(index, 1)[0] : undefined;
      if (waiter) waiter.resolve(message as never);
      else this.#messages.push(message);
    });
  }

  public async open(auth: ConnectionAuth): Promise<BridgeMessageOfType<"welcome">> {
    await this.openTransport();
    this.sendConnect(auth);
    return this.waitFor("welcome");
  }

  public async requestApproval(): Promise<BridgeMessageOfType<"approval_required">> {
    await this.openTransport();
    this.sendConnect({ kind: "approval" });
    return this.waitFor("approval_required");
  }

  private async openTransport(): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve, reject) => {
        this.socket.once("open", () => resolve());
        this.socket.once("error", reject);
      });
    }
  }

  private sendConnect(auth: ConnectionAuth): void {
    this.send(
      createBridgeMessage("connect", {
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: [
          "tools",
          "resources",
          "prompts",
          "cancellation",
          "session-resume",
          "heartbeat",
        ],
        auth,
        app: this.app,
        origin: this.origin,
        runtime: this.runtime,
      }),
    );
  }

  public async register(sessionId: string, registration: CapabilityRegistration): Promise<void> {
    this.send(createBridgeMessage("register", { sessionId, registration }));
    const response = await this.waitFor("registered");
    if (response.payload.registrationId !== registration.id) {
      throw new Error("Unexpected registration acknowledgement");
    }
  }

  public send(message: BridgeMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  public waitFor<T extends BridgeMessage["type"]>(
    type: T,
    timeoutMs = 2_000,
  ): Promise<BridgeMessageOfType<T>> {
    const index = this.#messages.findIndex((message) => message.type === type);
    const existing = index >= 0 ? this.#messages.splice(index, 1)[0] : undefined;
    if (existing) return Promise.resolve(existing as BridgeMessageOfType<T>);
    return new Promise<BridgeMessageOfType<T>>((resolve, reject) => {
      const waiter: Waiter = {
        type,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message as BridgeMessageOfType<T>);
        },
      };
      const timer = setTimeout(() => {
        const waiterIndex = this.#waiters.indexOf(waiter);
        if (waiterIndex >= 0) this.#waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }

  public async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close(1000);
    });
  }
}
