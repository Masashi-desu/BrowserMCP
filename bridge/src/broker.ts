import { randomUUID } from "node:crypto";

import {
  createBridgeMessage,
  type InvocationOperation,
  type InvocationResult,
  type ProtocolErrorCode,
} from "@browsermcp/protocol";

import type { BridgeLimits } from "./config.js";
import { BridgeError } from "./errors.js";
import { type RingLogger, safeText } from "./logger.js";
import type { RecentRequestStore } from "./recent-requests.js";
import type { RegisteredCapability } from "./registry.js";

export interface BrowserSender {
  send(connectionId: string, message: ReturnType<typeof createBridgeMessage>): boolean;
}

interface PendingInvocation {
  readonly expectedKind: InvocationResult["kind"];
  readonly provider: RegisteredCapability;
  readonly reject: (reason: BridgeError) => void;
  readonly resolve: (result: InvocationResult) => void;
  readonly signal?: AbortSignal;
  readonly signalListener?: () => void;
  readonly timer: NodeJS.Timeout;
}

function outcomeFor(error: BridgeError): "cancelled" | "error" | "timeout" {
  if (error.code === "CANCELLED") return "cancelled";
  if (error.code === "TIMEOUT") return "timeout";
  return "error";
}

function errorFromBrowser(
  code: ProtocolErrorCode,
  message: string,
  details?: unknown,
): BridgeError {
  const bridgeCode =
    code === "INVOCATION_TIMEOUT"
      ? "TIMEOUT"
      : code === "INVOCATION_CANCELLED"
        ? "CANCELLED"
        : code === "RATE_LIMITED"
          ? "CONCURRENCY_LIMIT"
          : code === "CONNECTION_CLOSED" || code === "SESSION_EXPIRED"
            ? "BROWSER_DISCONNECTED"
            : "BROWSER_ERROR";
  return new BridgeError(bridgeCode, safeText(message), { browserCode: code, details });
}

export class InvocationBroker {
  readonly #activeByConnection = new Map<string, number>();
  readonly #cancelled = new Map<string, { connectionId: string; expiresAt: number }>();
  readonly #limits: BridgeLimits;
  readonly #logger: RingLogger;
  readonly #maxCancelledTombstones: number;
  readonly #now: () => number;
  readonly #pending = new Map<string, PendingInvocation>();
  readonly #recent: RecentRequestStore;
  readonly #sender: BrowserSender;

  public constructor(options: {
    limits: BridgeLimits;
    logger: RingLogger;
    recent: RecentRequestStore;
    sender: BrowserSender;
    now?: () => number;
  }) {
    this.#limits = options.limits;
    this.#logger = options.logger;
    this.#recent = options.recent;
    this.#sender = options.sender;
    this.#now = options.now ?? Date.now;
    this.#maxCancelledTombstones = Math.max(32, options.limits.maxConcurrentRequests * 2);
  }

  public invoke(
    provider: RegisteredCapability,
    operation: InvocationOperation,
    signal?: AbortSignal,
  ): Promise<InvocationResult> {
    if (this.#pending.size >= this.#limits.maxConcurrentRequests) {
      throw new BridgeError("CONCURRENCY_LIMIT", "Bridge concurrent request limit reached");
    }
    const connectionId = provider.session.connectionId;
    const activeForConnection = this.#activeByConnection.get(connectionId) ?? 0;
    if (activeForConnection >= this.#limits.maxConcurrentRequestsPerRuntime) {
      throw new BridgeError(
        "CONCURRENCY_LIMIT",
        "Browser runtime concurrent request limit reached",
      );
    }
    if (signal?.aborted) throw new BridgeError("CANCELLED", "MCP request was cancelled");

    const invocationId = randomUUID();
    const expectedKind =
      operation.kind === "tool.call"
        ? "tool"
        : operation.kind === "resource.read"
          ? "resource"
          : "prompt";
    const message = createBridgeMessage("invoke", {
      sessionId: provider.session.sessionId,
      invocationId,
      registrationId: provider.registration.id,
      operation,
      timeoutMs: this.#limits.browserRequestTimeoutMs,
    });

    this.#recent.start({
      appId: provider.session.app.id,
      invocationId,
      kind: operation.kind,
      registrationId: provider.registration.id,
    });
    this.#activeByConnection.set(connectionId, activeForConnection + 1);

    return new Promise<InvocationResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          invocationId,
          new BridgeError("TIMEOUT", "Browser invocation timed out", {
            timeoutMs: this.#limits.browserRequestTimeoutMs,
          }),
          true,
        );
      }, this.#limits.browserRequestTimeoutMs);
      timer.unref();

      const signalListener = signal
        ? () => {
            this.fail(
              invocationId,
              new BridgeError("CANCELLED", "MCP request was cancelled"),
              true,
            );
          }
        : undefined;
      if (signal && signalListener)
        signal.addEventListener("abort", signalListener, { once: true });

      this.#pending.set(invocationId, {
        expectedKind,
        provider,
        reject,
        resolve,
        ...(signal ? { signal } : {}),
        ...(signalListener ? { signalListener } : {}),
        timer,
      });

      let sent = false;
      try {
        sent = this.#sender.send(connectionId, message);
      } catch {
        // Treat sender failures like a closed browser connection while ensuring
        // the request slot, timer, and recent-request entry are all finalized.
      }
      if (!sent) {
        this.fail(
          invocationId,
          new BridgeError("BROWSER_DISCONNECTED", "Browser disconnected before invocation"),
          false,
        );
      }
    });
  }

  public resolve(connectionId: string, invocationId: string, output: InvocationResult): boolean {
    const pending = this.#pending.get(invocationId);
    if (!pending) return this.consumeCancellation(connectionId, invocationId);
    if (pending.provider.session.connectionId !== connectionId) return false;
    if (pending.expectedKind !== output.kind) {
      this.fail(
        invocationId,
        new BridgeError(
          "INVALID_MESSAGE",
          `Expected a ${pending.expectedKind} result, received ${output.kind}`,
        ),
        false,
      );
      return true;
    }
    this.cleanup(invocationId, pending);
    this.#recent.finish(invocationId, "success", undefined, {
      kind: output.kind,
      itemCount:
        output.kind === "tool"
          ? output.content.length
          : output.kind === "resource"
            ? output.contents.length
            : output.messages.length,
      ...(output.kind === "tool" && output.isError !== undefined
        ? { isError: output.isError }
        : {}),
    });
    pending.resolve(output);
    return true;
  }

  public rejectFromBrowser(
    connectionId: string,
    invocationId: string,
    code: ProtocolErrorCode,
    message: string,
    details?: unknown,
  ): boolean {
    const pending = this.#pending.get(invocationId);
    if (!pending) return this.consumeCancellation(connectionId, invocationId);
    if (pending.provider.session.connectionId !== connectionId) return false;
    this.fail(invocationId, errorFromBrowser(code, message, details), false);
    return true;
  }

  public cancelFromBrowser(connectionId: string, invocationId: string): boolean {
    const pending = this.#pending.get(invocationId);
    if (!pending) return this.consumeCancellation(connectionId, invocationId);
    if (pending.provider.session.connectionId !== connectionId) return false;
    this.fail(
      invocationId,
      new BridgeError("CANCELLED", "Browser cancelled the invocation"),
      false,
    );
    return true;
  }

  public disconnect(connectionId: string): void {
    for (const [invocationId, pending] of this.#pending) {
      if (pending.provider.session.connectionId === connectionId) {
        this.fail(
          invocationId,
          new BridgeError("BROWSER_DISCONNECTED", "Browser disconnected during invocation"),
          false,
        );
      }
    }
    for (const [invocationId, cancellation] of this.#cancelled) {
      if (cancellation.connectionId === connectionId) this.#cancelled.delete(invocationId);
    }
  }

  public close(): void {
    for (const invocationId of [...this.#pending.keys()]) {
      this.fail(invocationId, new BridgeError("BROWSER_DISCONNECTED", "Bridge is stopping"), false);
    }
    this.#cancelled.clear();
  }

  public get cancellationTombstoneCount(): number {
    this.sweepCancellations();
    return this.#cancelled.size;
  }

  public get cancellationTombstoneLimit(): number {
    return this.#maxCancelledTombstones;
  }

  private fail(invocationId: string, error: BridgeError, notifyBrowser: boolean): void {
    const pending = this.#pending.get(invocationId);
    if (!pending) return;
    if (notifyBrowser) {
      this.sweepCancellations();
      while (this.#cancelled.size >= this.#maxCancelledTombstones) {
        const oldest = this.#cancelled.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#cancelled.delete(oldest);
      }
      this.#cancelled.set(invocationId, {
        connectionId: pending.provider.session.connectionId,
        expiresAt: this.#now() + this.#limits.browserRequestTimeoutMs,
      });
      this.#sender.send(
        pending.provider.session.connectionId,
        createBridgeMessage("cancel", {
          sessionId: pending.provider.session.sessionId,
          invocationId,
          reason: error.message,
        }),
      );
    }
    this.cleanup(invocationId, pending);
    this.#recent.finish(invocationId, outcomeFor(error), {
      code: error.code,
      message: error.message,
    });
    this.#logger.warn("Browser invocation failed", {
      code: error.code,
      connectionId: pending.provider.session.connectionId,
      invocationId,
    });
    pending.reject(error);
  }

  private cleanup(invocationId: string, pending: PendingInvocation): void {
    clearTimeout(pending.timer);
    if (pending.signal && pending.signalListener) {
      pending.signal.removeEventListener("abort", pending.signalListener);
    }
    this.#pending.delete(invocationId);
    const connectionId = pending.provider.session.connectionId;
    const nextCount = Math.max(0, (this.#activeByConnection.get(connectionId) ?? 1) - 1);
    if (nextCount === 0) this.#activeByConnection.delete(connectionId);
    else this.#activeByConnection.set(connectionId, nextCount);
  }

  private consumeCancellation(connectionId: string, invocationId: string): boolean {
    this.sweepCancellations();
    const cancellation = this.#cancelled.get(invocationId);
    if (!cancellation || cancellation.connectionId !== connectionId) return false;
    this.#cancelled.delete(invocationId);
    return true;
  }

  private sweepCancellations(): void {
    const now = this.#now();
    for (const [id, cancellation] of this.#cancelled) {
      if (cancellation.expiresAt <= now) this.#cancelled.delete(id);
    }
  }
}
