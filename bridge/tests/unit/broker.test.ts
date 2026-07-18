import type { BridgeMessage, JsonValue } from "@browsermcp/protocol";
import { describe, expect, it } from "vitest";

import { InvocationBroker } from "../../src/broker.js";
import { DEFAULT_LIMITS } from "../../src/config.js";
import type { BridgeError } from "../../src/errors.js";
import { RingLogger } from "../../src/logger.js";
import { RecentRequestStore } from "../../src/recent-requests.js";
import type { RegisteredCapability, ToolRegistration } from "../../src/registry.js";

const provider: RegisteredCapability<ToolRegistration> = {
  exposedName: "docs_deadbeef__search",
  registration: {
    kind: "tool",
    id: "search",
    name: "search",
    inputSchema: {},
  },
  session: {
    app: { id: "docs", name: "Docs", version: "1.0.0" },
    capabilities: ["tools"],
    connectedAt: new Date().toISOString(),
    connectionId: "connection-1",
    origin: "https://docs.test",
    protocolVersion: "1.0.0",
    runtime: { id: "runtime-1", instanceId: "tab-1" },
    sessionId: "session-1",
  },
};

describe("invocation broker", () => {
  it("correlates concurrent browser results by invocation id", async () => {
    const sent: BridgeMessage[] = [];
    const recent = new RecentRequestStore();
    const broker = new InvocationBroker({
      limits: DEFAULT_LIMITS,
      logger: new RingLogger(),
      recent,
      sender: {
        send: (_connectionId, message) => {
          sent.push(message);
          return true;
        },
      },
    });

    const pending = broker.invoke(provider, { kind: "tool.call", arguments: { query: "mcp" } });
    const secondPending = broker.invoke(provider, {
      kind: "tool.call",
      arguments: { query: "browser" },
    });
    const invoke = sent[0];
    const secondInvoke = sent[1];
    expect(invoke?.type).toBe("invoke");
    if (invoke?.type !== "invoke" || secondInvoke?.type !== "invoke") {
      throw new Error("invoke messages not sent");
    }
    expect(
      broker.resolve("connection-1", secondInvoke.payload.invocationId, {
        kind: "tool",
        content: [{ type: "text", text: "second" }],
      }),
    ).toBe(true);
    expect(
      broker.resolve("connection-1", invoke.payload.invocationId, {
        kind: "tool",
        content: [{ type: "text", text: "result" }],
      }),
    ).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: "tool" });
    await expect(secondPending).resolves.toMatchObject({ kind: "tool" });
    expect(recent.recent().map(({ outcome }) => outcome)).toEqual(["success", "success"]);
  });

  it("forwards AbortSignal cancellation and records it", async () => {
    const sent: BridgeMessage[] = [];
    const recent = new RecentRequestStore();
    const broker = new InvocationBroker({
      limits: DEFAULT_LIMITS,
      logger: new RingLogger(),
      recent,
      sender: {
        send: (_connectionId, message) => {
          sent.push(message);
          return true;
        },
      },
    });
    const controller = new AbortController();
    const pending = broker.invoke(
      provider,
      { kind: "tool.call", arguments: {} },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
    } satisfies Partial<BridgeError>);
    expect(sent.map(({ type }) => type)).toEqual(["invoke", "cancel"]);
    const invoke = sent[0];
    if (invoke?.type !== "invoke") throw new Error("invoke message not sent");
    expect(
      broker.rejectFromBrowser(
        "connection-1",
        invoke.payload.invocationId,
        "INVOCATION_CANCELLED",
        "cancel acknowledged",
      ),
    ).toBe(true);
    expect(recent.recent()[0]?.outcome).toBe("cancelled");
  });

  it("enforces per-runtime concurrency", () => {
    const broker = new InvocationBroker({
      limits: { ...DEFAULT_LIMITS, maxConcurrentRequestsPerRuntime: 1 },
      logger: new RingLogger(),
      recent: new RecentRequestStore(),
      sender: { send: () => true },
    });
    void broker.invoke(provider, { kind: "tool.call", arguments: {} }).catch(() => undefined);
    expect(() => broker.invoke(provider, { kind: "tool.call", arguments: {} })).toThrowError(
      /concurrent request limit/,
    );
    broker.close();
  });

  it("does not consume request slots when protocol validation rejects arguments", async () => {
    const sent: BridgeMessage[] = [];
    const recent = new RecentRequestStore();
    const broker = new InvocationBroker({
      limits: {
        ...DEFAULT_LIMITS,
        maxConcurrentRequests: 1,
        maxConcurrentRequestsPerRuntime: 1,
      },
      logger: new RingLogger(),
      recent,
      sender: {
        send: (_connectionId, message) => {
          sent.push(message);
          return true;
        },
      },
    });

    expect(() =>
      broker.invoke(provider, {
        kind: "tool.call",
        arguments: { constructor: "must be rejected" },
      }),
    ).toThrowError(/unsafe object key/i);
    expect(recent.recent()).toEqual([]);

    let deeplyNested: JsonValue = "leaf";
    for (let depth = 0; depth < 40; depth += 1) deeplyNested = { child: deeplyNested };
    expect(() =>
      broker.invoke(provider, {
        kind: "tool.call",
        arguments: { deeplyNested },
      }),
    ).toThrowError(/nesting depth/i);
    expect(recent.recent()).toEqual([]);

    const pending = broker.invoke(provider, {
      kind: "tool.call",
      arguments: { query: "valid" },
    });
    const invoke = sent[0];
    if (invoke?.type !== "invoke") throw new Error("invoke message not sent");
    expect(
      broker.resolve("connection-1", invoke.payload.invocationId, {
        kind: "tool",
        content: [{ type: "text", text: "ok" }],
      }),
    ).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: "tool" });
  });

  it("sweeps and caps cancellation tombstones without waiting for late responses", async () => {
    let now = 1_000;
    const limits = {
      ...DEFAULT_LIMITS,
      browserRequestTimeoutMs: 500,
      maxConcurrentRequests: 1,
    };
    const broker = new InvocationBroker({
      limits,
      logger: new RingLogger(),
      now: () => now,
      recent: new RecentRequestStore(),
      sender: { send: () => true },
    });
    for (let index = 0; index < 40; index += 1) {
      const controller = new AbortController();
      const pending = broker.invoke(
        provider,
        { kind: "tool.call", arguments: { index } },
        controller.signal,
      );
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    }
    expect(broker.cancellationTombstoneCount).toBe(broker.cancellationTombstoneLimit);
    expect(broker.cancellationTombstoneCount).toBe(32);

    now += limits.browserRequestTimeoutMs + 1;
    const controller = new AbortController();
    const pending = broker.invoke(
      provider,
      { kind: "tool.call", arguments: {} },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(broker.cancellationTombstoneCount).toBe(1);
  });

  it("preserves browser timeout semantics when it wins the local timeout race", async () => {
    const sent: BridgeMessage[] = [];
    const recent = new RecentRequestStore();
    const broker = new InvocationBroker({
      limits: { ...DEFAULT_LIMITS, browserRequestTimeoutMs: 1_000 },
      logger: new RingLogger(),
      recent,
      sender: {
        send: (_connectionId, message) => {
          sent.push(message);
          return true;
        },
      },
    });
    const pending = broker.invoke(provider, { kind: "tool.call", arguments: {} });
    const invoke = sent[0];
    if (invoke?.type !== "invoke") throw new Error("invoke message not sent");
    expect(
      broker.rejectFromBrowser(
        "connection-1",
        invoke.payload.invocationId,
        "INVOCATION_TIMEOUT",
        "Browser handler deadline elapsed",
      ),
    ).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(recent.recent()[0]).toMatchObject({ outcome: "timeout" });
    expect(sent.map(({ type }) => type)).toEqual(["invoke"]);
  });
});
