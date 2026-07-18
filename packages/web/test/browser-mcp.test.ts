import { type BridgeMessageOfType, createBridgeMessage } from "@browsermcp/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserMCP, type BrowserMCPSnapshot, type StoredBrowserMCPSession } from "../src/index.js";
import { FakeBridge } from "./fakes.js";

const TOKEN = "pairing-token-1234567890";

function createApp(
  bridge: FakeBridge,
  overrides: Partial<ConstructorParameters<typeof BrowserMCP>[0]> = {},
): BrowserMCP {
  return new BrowserMCP({
    name: "Test App",
    version: "0.1.0",
    appId: "test.app",
    runtimeId: "runtime-1",
    instanceId: "instance-1",
    origin: "https://app.example.test",
    bridgeUrl: "wss://127.0.0.1:8789/browser",
    token: TOKEN,
    webSocketFactory: bridge.factory,
    reconnect: false,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("declarative registration and lifecycle", () => {
  it("registers and unregisters tools, resources and prompts", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    const snapshots: BrowserMCPSnapshot[] = [];
    app.subscribe((snapshot) => snapshots.push(snapshot));

    const tool = app.tool({
      name: "example.tool",
      description: "Example tool",
      inputSchema: { type: "object" },
      handler: async () => ({ content: [] }),
    });
    const resource = app.resource({
      name: "example.resource",
      uri: "browsermcp://example/resource",
      handler: async ({ uri }) => ({ contents: [{ uri, text: "value" }] }),
    });
    const prompt = app.prompt({
      name: "example.prompt",
      arguments: [{ name: "topic", required: true }],
      handler: async ({ topic }) => ({
        messages: [{ role: "user", content: { type: "text", text: topic ?? "" } }],
      }),
    });

    const session = await app.connect();
    await Promise.all([tool.ready, resource.ready, prompt.ready]);

    expect(session.id).toBe("session-1");
    expect(session).not.toHaveProperty("resumeToken");
    expect(app.connectionState).toBe("connected");
    expect(app.getRegistrations()).toEqual([
      expect.objectContaining({ id: tool.id, kind: "tool", status: "registered" }),
      expect.objectContaining({ id: resource.id, kind: "resource", status: "registered" }),
      expect.objectContaining({ id: prompt.id, kind: "prompt", status: "registered" }),
    ]);
    expect(
      bridge.received
        .filter((message) => message.type === "register")
        .map((message) => (message.type === "register" ? message.payload.registration.kind : "")),
    ).toEqual(["tool", "resource", "prompt"]);

    await tool.unregister();
    expect(app.getRegistrations()).toHaveLength(2);
    expect(bridge.received.some((message) => message.type === "unregister")).toBe(true);

    await app.disconnect();
    expect(app.connectionState).toBe("disconnected");
    expect(bridge.received.at(-1)?.type).toBe("disconnect");
    expect(snapshots.some((snapshot) => snapshot.connectionState === "connected")).toBe(true);
  });

  it("supports dynamic registration after connection", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    await app.connect();

    const handle = app.tool({
      name: "dynamic.tool",
      inputSchema: { type: "object" },
      handler: () => ({ content: [] }),
    });
    await handle.ready;

    expect(app.getRegistrations()).toContainEqual(
      expect.objectContaining({ id: handle.id, status: "registered" }),
    );
  });

  it("keeps a local registration active when Bridge unregistration fails", async () => {
    const bridge = new FakeBridge({ rejectUnregistrations: true });
    const app = createApp(bridge);
    const handle = app.tool({
      name: "retained.tool",
      inputSchema: { type: "object" },
      handler: () => ({ content: [{ type: "text", text: "still active" }] }),
    });
    await app.connect();
    await handle.ready;

    await expect(handle.unregister()).rejects.toMatchObject({
      protocolCode: "REGISTRATION_REJECTED",
    });
    expect(app.getRegistrations()).toContainEqual(
      expect.objectContaining({ id: handle.id, status: "registered" }),
    );

    bridge.sendInvoke({
      invocationId: "invocation-after-unregister-failure",
      registrationId: handle.id,
      operation: { kind: "tool.call", arguments: {} },
    });
    await vi.waitFor(() => {
      expect(
        bridge.received.some(
          (message) =>
            message.type === "result" &&
            message.payload.invocationId === "invocation-after-unregister-failure",
        ),
      ).toBe(true);
    });
  });

  it("fails the transport when a registered reply acknowledges a different registration", async () => {
    const bridge = new FakeBridge({ wrongRegisteredId: true });
    const app = createApp(bridge);
    const handle = app.tool({
      name: "wrong.registered.ack",
      inputSchema: { type: "object" },
      handler: () => ({ content: [] }),
    });

    await expect(app.connect()).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    await expect(handle.ready).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(bridge.socket.readyState).toBe(3);
    expect(app.connectionState).toBe("error");
    expect(app.getRegistrations()).toContainEqual(
      expect.objectContaining({ id: handle.id, status: "rejected" }),
    );
  });

  it("fails the transport and retains local state for a mismatched unregistered reply", async () => {
    const bridge = new FakeBridge({ wrongUnregisteredId: true });
    const app = createApp(bridge);
    const handle = app.tool({
      name: "wrong.unregistered.ack",
      inputSchema: { type: "object" },
      handler: () => ({ content: [] }),
    });
    await app.connect();
    await handle.ready;

    await expect(handle.unregister()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(bridge.socket.readyState).toBe(3);
    expect(app.connectionState).toBe("error");
    expect(app.getRegistrations()).toContainEqual(
      expect.objectContaining({ id: handle.id, status: "pending" }),
    );
  });

  it("reconnects with a rotated resume credential and re-registers capabilities", async () => {
    const bridge = new FakeBridge();
    const guardedFactory = vi.fn((url: string) => {
      const previous = bridge.sockets.at(-1);
      if (previous !== undefined) expect(previous.readyState).toBe(3);
      return bridge.factory(url);
    });
    const app = createApp(bridge, { webSocketFactory: guardedFactory });
    const handle = app.tool({
      name: "resume.tool",
      inputSchema: { type: "object" },
      handler: () => ({ content: [] }),
    });
    await app.connect();
    await handle.ready;
    await app.reconnect();

    const connects = bridge.connectMessages();
    expect(connects).toHaveLength(2);
    expect(connects[0]?.payload.auth).toEqual({ kind: "pairing", token: TOKEN });
    expect(connects[1]?.payload.auth).toEqual(
      expect.objectContaining({ kind: "resume", sessionId: "session-1" }),
    );
    expect(bridge.received.filter((message) => message.type === "register")).toHaveLength(2);
    expect(bridge.lastUrl).toBe("wss://127.0.0.1:8789/browser");
    expect(bridge.lastUrl).not.toContain(TOKEN);
    expect(guardedFactory).toHaveBeenCalledTimes(2);
  });

  it("continues reconnect cleanup when an OPEN socket throws from send", async () => {
    const bridge = new FakeBridge({ throwOnDisconnectSendOnce: true });
    const app = createApp(bridge);
    await app.connect();

    await expect(app.reconnect()).resolves.toMatchObject({ id: "session-1" });
    expect(bridge.sockets).toHaveLength(2);
    expect(bridge.sockets[0]?.readyState).toBe(3);
    expect(bridge.sockets[1]?.readyState).toBe(1);
    expect(app.connectionState).toBe("connected");
    expect(
      app.getLogs().some(({ event }) => event === "connection.reconnect_disconnect_failed"),
    ).toBe(true);

    await app.disconnect();
  });

  it("does not loop after the Bridge rejects a resume credential", async () => {
    const bridge = new FakeBridge({ rejectResume: true });
    const app = createApp(bridge, {
      reconnect: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
    });
    await app.connect();

    await expect(app.reconnect()).rejects.toMatchObject({
      protocolCode: "SESSION_RESUME_REJECTED",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridge.sockets).toHaveLength(2);
    expect(app.connectionState).toBe("error");
  });

  it("does not reconnect after the Bridge revokes resume on disconnect", async () => {
    const bridge = new FakeBridge();
    const sessionStore = {
      load: vi.fn(() => undefined),
      save: vi.fn(() => undefined),
      clear: vi.fn(() => undefined),
    };
    const app = createApp(bridge, {
      sessionStore,
      reconnect: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
    });
    await app.connect();

    bridge.socket.receive(
      createBridgeMessage("disconnect", {
        sessionId: bridge.currentSessionId(),
        code: "BRIDGE_STOPPING",
        reason: "Bridge is stopping",
        canResume: false,
      }),
    );

    await vi.waitFor(() => expect(app.connectionState).toBe("error"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionStore.clear).toHaveBeenCalled();
    expect(bridge.sockets).toHaveLength(1);
    expect(app.getSnapshot().session).toBeUndefined();
  });

  it("stops automatic reconnect when the local resume credential has expired", async () => {
    const bridge = new FakeBridge({ sessionTtlMs: 1 });
    const app = createApp(bridge, {
      reconnect: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
    });
    await app.connect();
    await new Promise((resolve) => setTimeout(resolve, 5));
    bridge.socket.close(1006, "transport lost after session expiry");

    await vi.waitFor(() => expect(app.getSnapshot().lastError?.code).toBe("AUTH_REQUIRED"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridge.sockets).toHaveLength(1);
    expect(app.connectionState).toBe("error");
    expect(app.getSnapshot().session).toBeUndefined();
  });

  it("consumes a constructor pairing token and requests approval on a later fresh connection", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    await app.connect();
    await app.disconnect();

    await expect(app.connect()).resolves.toMatchObject({ id: "session-2" });
    expect(bridge.connectMessages().map((message) => message.payload.auth.kind)).toEqual([
      "pairing",
      "approval",
    ]);
  });

  it("does not persist a token passed to connect and falls back to operator approval", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, { token: undefined });
    await app.connect({ token: TOKEN });
    await app.disconnect();

    await expect(app.connect()).resolves.toMatchObject({ id: "session-2" });
    expect(bridge.connectMessages().map((message) => message.payload.auth.kind)).toEqual([
      "pairing",
      "approval",
    ]);
  });

  it("cancels a scheduled automatic reconnect when connect is requested explicitly", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, {
      reconnect: { maxAttempts: 3, initialDelayMs: 50, maxDelayMs: 50 },
    });
    await app.connect();
    bridge.socket.close(1006, "transport lost");
    await vi.waitFor(() => expect(app.connectionState).toBe("reconnecting"));

    await app.connect();
    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(bridge.sockets).toHaveLength(2);
    expect(app.connectionState).toBe("connected");
  });

  it("shares concurrent lifecycle operations and serializes disconnect after reconnect", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    await app.connect();

    const firstReconnect = app.reconnect();
    const secondReconnect = app.reconnect();
    const joinedConnect = app.connect();
    expect(secondReconnect).toBe(firstReconnect);
    expect(joinedConnect).toBe(firstReconnect);

    const firstDisconnect = app.disconnect();
    const secondDisconnect = app.disconnect();
    expect(secondDisconnect).toBe(firstDisconnect);

    await firstReconnect;
    await firstDisconnect;
    expect(app.connectionState).toBe("disconnected");
    expect(bridge.sockets).toHaveLength(2);
  });

  it("disconnects an in-flight connection preparation without opening a late socket", async () => {
    const bridge = new FakeBridge();
    const fetcher = vi.fn<typeof fetch>(
      async (_input, request) =>
        await new Promise<Response>((_resolve, reject) => {
          request?.signal?.addEventListener(
            "abort",
            () => reject(request.signal?.reason ?? new Error("aborted")),
            { once: true },
          );
        }),
    );
    const app = createApp(bridge, {
      prepareLocalNetworkAccess: { fetcher },
    });
    const connecting = app.connect();
    const rejected = expect(connecting).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    await app.disconnect();
    await rejected;

    expect(app.connectionState).toBe("disconnected");
    expect(bridge.sockets).toHaveLength(0);
  });

  it("queues connect until an in-flight disconnect and delayed store clear finish", async () => {
    const bridge = new FakeBridge();
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    const clear = vi.fn(async () => await clearGate);
    const app = createApp(bridge, {
      sessionStore: { load: () => undefined, save: () => undefined, clear },
    });
    await app.connect();

    const disconnecting = app.disconnect();
    const connecting = app.connect({ token: TOKEN });
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
    expect(bridge.sockets).toHaveLength(1);

    releaseClear();
    await disconnecting;
    await connecting;
    expect(bridge.sockets).toHaveLength(2);
    expect(app.connectionState).toBe("connected");
  });

  it("waits for explicit operator approval when no credential is available", async () => {
    const bridge = new FakeBridge({ deferApproval: true });
    const app = createApp(bridge, { token: undefined, getToken: undefined });

    const connecting = app.connect();
    await vi.waitFor(() => expect(app.connectionState).toBe("awaiting-approval"));
    expect(app.getSnapshot().approval).toMatchObject({
      requestId: "approval-1",
      origin: "https://app.example.test",
    });
    expect(bridge.connectMessages()[0]?.payload.auth).toEqual({ kind: "approval" });

    bridge.approvePending();
    await expect(connecting).resolves.toMatchObject({ id: "session-1" });
    expect(app.getSnapshot().approval).toBeUndefined();
    expect(app.connectionState).toBe("connected");
  });

  it("requests fresh operator approval from an explicit reconnect when resume is unavailable", async () => {
    const bridge = new FakeBridge({ deferApproval: true });
    const app = createApp(bridge, { token: undefined, getToken: undefined });

    const firstConnect = app.connect();
    await vi.waitFor(() => expect(app.connectionState).toBe("awaiting-approval"));
    bridge.approvePending();
    await firstConnect;
    await app.disconnect();

    const reconnecting = app.reconnect();
    await vi.waitFor(() => expect(app.connectionState).toBe("awaiting-approval"));
    expect(bridge.connectMessages().map((message) => message.payload.auth.kind)).toEqual([
      "approval",
      "approval",
    ]);
    bridge.approvePending();
    await expect(reconnecting).resolves.toMatchObject({ id: "session-2" });
  });

  it("can require an existing credential without creating an approval request", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, { token: undefined, getToken: undefined });

    await expect(app.connect({ requestApproval: false })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(bridge.sockets).toHaveLength(0);
  });

  it("recovers after the WebSocket factory throws synchronously", async () => {
    const bridge = new FakeBridge();
    let factoryAttempts = 0;
    const app = createApp(bridge, {
      webSocketFactory: (url) => {
        factoryAttempts += 1;
        if (factoryAttempts === 1) throw new Error("Synthetic factory failure");
        return bridge.factory(url);
      },
    });

    await expect(app.connect()).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    expect(app.connectionState).toBe("error");
    expect(bridge.sockets).toHaveLength(0);

    await expect(app.connect({ token: TOKEN })).resolves.toMatchObject({ id: "session-1" });
    expect(factoryAttempts).toBe(2);
    expect(bridge.sockets).toHaveLength(1);
    expect(app.connectionState).toBe("connected");
    await app.disconnect();
  });

  it("rejects ws when an explicit non-DOM Origin is HTTPS", () => {
    const bridge = new FakeBridge();
    expect(() => createApp(bridge, { bridgeUrl: "ws://127.0.0.1:8789/browser" })).toThrowError(
      expect.objectContaining({ code: "INSECURE_BRIDGE_URL" }),
    );
    expect(bridge.sockets).toHaveLength(0);
  });

  it("moves to error when Local Network Access preparation fails before socket creation", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, {
      prepareLocalNetworkAccess: {
        fetcher: vi.fn<typeof fetch>(async () => {
          throw new TypeError("permission denied");
        }),
      },
    });

    await expect(app.connect()).rejects.toMatchObject({
      code: "LOCAL_NETWORK_ACCESS_FAILED",
    });
    expect(app.connectionState).toBe("error");
    expect(bridge.sockets).toHaveLength(0);
  });

  it("converts session store failures before socket creation into a connection error", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, {
      sessionStore: {
        load: async () => {
          throw new Error("storage unavailable");
        },
        save: () => undefined,
        clear: () => undefined,
      },
    });

    await expect(app.connect()).rejects.toMatchObject({ code: "SESSION_STORE_FAILED" });
    expect(app.connectionState).toBe("error");
    expect(bridge.sockets).toHaveLength(0);
  });

  it("fails closed when the session store cannot save the welcome credential", async () => {
    const bridge = new FakeBridge();
    const clear = vi.fn(() => undefined);
    const app = createApp(bridge, {
      sessionStore: {
        load: () => undefined,
        save: () => {
          throw new Error(
            "save failed at https://store.test/?access_token=must-not-leak-from-store-error",
          );
        },
        clear,
      },
    });

    await expect(app.connect()).rejects.toMatchObject({ code: "SESSION_STORE_FAILED" });
    expect(app.connectionState).toBe("error");
    expect(app.getSnapshot().session).toBeUndefined();
    expect(clear).toHaveBeenCalled();
    expect(JSON.stringify(app.getLogs())).not.toContain("must-not-leak-from-store-error");
  });

  it("ignores a stale welcome after async session save and reconnects on a new generation", async () => {
    const bridge = new FakeBridge();
    let stored: StoredBrowserMCPSession | undefined;
    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    let saveCount = 0;
    const app = createApp(bridge, {
      reconnect: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
      sessionStore: {
        load: () => stored,
        save: async (_appId, value) => {
          stored = value;
          saveCount += 1;
          if (saveCount === 1) await firstSaveGate;
        },
        clear: () => {
          stored = undefined;
        },
      },
    });
    const initial = app.connect();
    const initialFailure = expect(initial).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(saveCount).toBe(1));
    bridge.socket.close(1006, "transport lost during save");
    await initialFailure;

    releaseFirstSave();
    await vi.waitFor(() => expect(app.connectionState).toBe("connected"));
    expect(bridge.sockets).toHaveLength(2);
    expect(saveCount).toBe(2);
    expect(app.getSnapshot().session?.id).toBe("session-1");
  });

  it("ignores a stale async session-save rejection after a new generation succeeds", async () => {
    const bridge = new FakeBridge();
    let stored: StoredBrowserMCPSession | undefined;
    let rejectFirstSave!: (reason: Error) => void;
    const firstSaveGate = new Promise<void>((_resolve, reject) => {
      rejectFirstSave = reject;
    });
    let saveCount = 0;
    const clear = vi.fn(() => {
      stored = undefined;
    });
    const app = createApp(bridge, {
      getToken: () => TOKEN,
      reconnect: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
      sessionStore: {
        load: () => stored,
        save: async (_appId, value) => {
          saveCount += 1;
          if (saveCount === 1) await firstSaveGate;
          stored = value;
        },
        clear,
      },
    });
    const initial = app.connect();
    const initialFailure = expect(initial).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(saveCount).toBe(1));
    bridge.socket.close(1006, "transport lost during failing save");
    await initialFailure;

    rejectFirstSave(new Error("delayed first-generation save failure"));
    await vi.waitFor(() => expect(app.connectionState).toBe("connected"));

    expect(bridge.sockets).toHaveLength(2);
    expect(saveCount).toBe(2);
    expect(clear).not.toHaveBeenCalled();
    expect(stored?.session.id).toBe("session-2");
    expect(app.getSnapshot().session?.id).toBe("session-2");
    expect(app.getSnapshot().lastError?.code).not.toBe("SESSION_STORE_FAILED");
  });

  it("finishes transport and memory cleanup when session store clear rejects", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, {
      sessionStore: {
        load: () => undefined,
        save: () => undefined,
        clear: () => {
          throw new Error("clear failed");
        },
      },
    });
    await app.connect();

    await expect(app.disconnect()).rejects.toMatchObject({ code: "SESSION_STORE_FAILED" });
    expect(app.connectionState).toBe("disconnected");
    expect(app.getSnapshot().session).toBeUndefined();
    expect(bridge.socket.readyState).toBe(3);
  });

  it("rejects an incomplete required v1 capability negotiation", async () => {
    const bridge = new FakeBridge({ capabilities: ["heartbeat"] });
    const app = createApp(bridge);

    await expect(app.connect()).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(app.connectionState).toBe("error");
  });

  it("rejects a capability the browser did not offer", async () => {
    const bridge = new FakeBridge({
      capabilities: [
        "tools",
        "resources",
        "prompts",
        "cancellation",
        "session-resume",
        "heartbeat",
        "extension.not-offered",
      ],
    });
    const app = createApp(bridge);

    await expect(app.connect()).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(app.connectionState).toBe("error");
  });
});

describe("invocation execution", () => {
  it("executes a tool, returns a correlated result, and records the execution", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    const handler = vi.fn(async (arguments_: { value: string }) => ({
      content: [{ type: "text" as const, text: arguments_.value.toUpperCase() }],
      structuredContent: { received: arguments_.value },
    }));
    const tool = app.tool<{ value: string }>({
      name: "uppercase",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
      handler,
    });
    await app.connect();
    await tool.ready;

    const invocationId = bridge.sendInvoke({
      invocationId: "invocation-success",
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: { value: "hello" } },
    });
    await vi.waitFor(() => {
      expect(
        bridge.received.find(
          (message) => message.type === "result" && message.payload.invocationId === invocationId,
        ),
      ).toBeDefined();
    });

    expect(handler).toHaveBeenCalledWith(
      { value: "hello" },
      expect.objectContaining({ invocationId, signal: expect.any(AbortSignal) }),
    );
    const result = bridge.received.find(
      (message): message is BridgeMessageOfType<"result"> =>
        message.type === "result" && message.payload.invocationId === invocationId,
    );
    expect(result?.payload.output).toEqual({
      kind: "tool",
      content: [{ type: "text", text: "HELLO" }],
      structuredContent: { received: "hello" },
    });
    expect(app.getRecentExecutions()[0]).toMatchObject({
      invocationId,
      status: "success",
    });
  });

  it("converts handler failures to protocol errors", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    const leakedToken = `bmp_pair_${"s".repeat(43)}`;
    const tool = app.tool({
      name: "failing.tool",
      inputSchema: { type: "object" },
      handler: () => {
        throw new Error(`Application failure ${leakedToken} Bearer opaqueCredential123`);
      },
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      invocationId: "invocation-error",
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
    });

    await vi.waitFor(() => {
      expect(
        bridge.received.find(
          (message) =>
            message.type === "error" && message.payload.invocationId === "invocation-error",
        ),
      ).toBeDefined();
    });
    const error = bridge.received.find(
      (message): message is BridgeMessageOfType<"error"> =>
        message.type === "error" && message.payload.invocationId === "invocation-error",
    );
    expect(error?.payload).toMatchObject({
      code: "HANDLER_ERROR",
      message: "Application failure [REDACTED] Bearer [REDACTED]",
    });
    expect(app.getRecentExecutions()[0]).toMatchObject({ status: "error" });
    const publicDiagnostics = JSON.stringify({
      recent: app.getRecentExecutions(),
      snapshot: app.getSnapshot(),
      logs: app.getLogs(),
    });
    expect(publicDiagnostics).not.toContain(leakedToken);
    expect(publicDiagnostics).not.toContain("opaqueCredential123");
  });

  it("contains a close/send race and leaves the execution terminal", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    let rejectHandler!: (reason: Error) => void;
    const handlerFailure = new Promise<never>((_resolve, reject) => {
      rejectHandler = reject;
    });
    const tool = app.tool({
      name: "close.race.tool",
      inputSchema: { type: "object" },
      handler: () => handlerFailure,
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      invocationId: "invocation-close-race",
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
    });
    await vi.waitFor(() => expect(app.getRecentExecutions()[0]?.status).toBe("running"));

    // Model the narrow interval where readyState is no longer OPEN but the close event has not run.
    bridge.socket.readyState = 3;
    rejectHandler(new Error("handler failed while the transport closed"));

    await vi.waitFor(() => {
      expect(app.getRecentExecutions()[0]?.status).toBe("error");
      expect(app.getLogs().some(({ event }) => event === "invocation.transport_failure")).toBe(
        true,
      );
    });
    expect(
      bridge.received.some(
        (message) =>
          message.type === "error" && message.payload.invocationId === "invocation-close-race",
      ),
    ).toBe(false);

    bridge.socket.readyState = 1;
    await app.disconnect();
  });

  it("returns a terminal error when a handler throws an empty message", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    const tool = app.tool({
      name: "empty.failure",
      inputSchema: { type: "object" },
      handler: () => {
        throw new Error("");
      },
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      invocationId: "invocation-empty-error",
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
    });

    await vi.waitFor(() => {
      expect(
        bridge.received.find(
          (message) =>
            message.type === "error" && message.payload.invocationId === "invocation-empty-error",
        ),
      ).toMatchObject({
        payload: { code: "HANDLER_ERROR", message: "Capability handler failed" },
      });
    });
    expect(app.getRecentExecutions()[0]).toMatchObject({
      invocationId: "invocation-empty-error",
      status: "error",
    });
  });

  it("executes resource and prompt handlers with typed operations and results", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    const resource = app.resource({
      name: "docs.page",
      uri: "browsermcp://docs/page",
      handler: ({ uri }) => ({
        contents: [{ uri, mimeType: "text/markdown", text: "# BrowserMCP" }],
      }),
    });
    const prompt = app.prompt({
      name: "docs.explain",
      arguments: [{ name: "topic", required: true }],
      handler: ({ topic }) => ({
        description: "Explain a BrowserMCP topic",
        messages: [{ role: "user", content: { type: "text", text: `Explain ${topic}` } }],
      }),
    });
    await app.connect();
    await Promise.all([resource.ready, prompt.ready]);

    bridge.sendInvoke({
      invocationId: "invocation-resource",
      registrationId: resource.id,
      operation: { kind: "resource.read", uri: "browsermcp://docs/page" },
    });
    bridge.sendInvoke({
      invocationId: "invocation-prompt",
      registrationId: prompt.id,
      operation: { kind: "prompt.get", arguments: { topic: "security" } },
    });

    await vi.waitFor(() => {
      expect(
        bridge.received.filter(
          (message) =>
            message.type === "result" &&
            (message.payload.invocationId === "invocation-resource" ||
              message.payload.invocationId === "invocation-prompt"),
        ),
      ).toHaveLength(2);
    });
    const results = bridge.received.filter(
      (message): message is BridgeMessageOfType<"result"> => message.type === "result",
    );
    expect(
      results.find((message) => message.payload.invocationId === "invocation-resource")?.payload
        .output,
    ).toEqual({
      kind: "resource",
      contents: [
        {
          uri: "browsermcp://docs/page",
          mimeType: "text/markdown",
          text: "# BrowserMCP",
        },
      ],
    });
    expect(
      results.find((message) => message.payload.invocationId === "invocation-prompt")?.payload
        .output,
    ).toEqual({
      kind: "prompt",
      description: "Explain a BrowserMCP topic",
      messages: [{ role: "user", content: { type: "text", text: "Explain security" } }],
    });
  });

  it("times out handlers and returns INVOCATION_TIMEOUT", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, { invocationTimeoutMs: 10 });
    const tool = app.tool({
      name: "slow.tool",
      inputSchema: { type: "object" },
      handler: () => new Promise<ToolResultNever>(() => undefined),
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      invocationId: "invocation-timeout",
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
      timeoutMs: 1_000,
    });

    await vi.waitFor(() => {
      expect(
        bridge.received.some(
          (message) => message.type === "error" && message.payload.code === "INVOCATION_TIMEOUT",
        ),
      ).toBe(true);
    });
    expect(app.getRecentExecutions()[0]).toMatchObject({ status: "timeout" });
  });

  it("cancels a running handler and acknowledges with INVOCATION_CANCELLED", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    let observedSignal: AbortSignal | undefined;
    const tool = app.tool({
      name: "cancel.tool",
      inputSchema: { type: "object" },
      handler: (_arguments, context) => {
        observedSignal = context.signal;
        return new Promise<ToolResultNever>(() => undefined);
      },
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      invocationId: "invocation-cancel",
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    bridge.socket.receive(
      createBridgeMessage("cancel", {
        sessionId: bridge.currentSessionId(),
        invocationId: "invocation-cancel",
        reason: "MCP client cancelled",
      }),
    );

    await vi.waitFor(() => {
      expect(
        bridge.received.some(
          (message) => message.type === "error" && message.payload.code === "INVOCATION_CANCELLED",
        ),
      ).toBe(true);
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(app.getRecentExecutions()[0]).toMatchObject({ status: "cancelled" });
  });

  it("answers ping with a correlated pong", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    await app.connect();
    const ping = createBridgeMessage("ping", {
      sessionId: bridge.currentSessionId(),
      nonce: "nonce-1",
    });
    bridge.socket.receive(ping);

    await vi.waitFor(() => {
      expect(
        bridge.received.find((message) => message.type === "pong" && message.replyTo === ping.id),
      ).toBeDefined();
    });
  });
});

describe("protocol failures and diagnostics", () => {
  it("rejects an invalid incoming message and does not reconnect", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    await app.connect();
    bridge.socket.receive('{"protocol":"not-browsermcp"}');

    await vi.waitFor(() => expect(app.connectionState).toBe("error"));
    expect(app.getSnapshot().lastError?.code).toBe("PROTOCOL_ERROR");
    expect(bridge.sockets).toHaveLength(1);
  });

  it("rejects a Bridge-selected protocol version that was not offered", async () => {
    const bridge = new FakeBridge({ selectedVersion: "2.0.0" });
    const app = createApp(bridge);

    await expect(app.connect()).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(app.connectionState).toBe("error");
  });

  it("times out a WebSocket that never opens", async () => {
    const bridge = new FakeBridge({ autoOpen: false });
    const app = createApp(bridge, { connectTimeoutMs: 10 });

    await expect(app.connect()).rejects.toMatchObject({ code: "CONNECTION_TIMEOUT" });
  });

  it("redacts credential-shaped log fields and retains bounded recent logs", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge, { maxLogEntries: 5 });
    const tool = app.tool({
      name: "log.tool",
      inputSchema: { type: "object" },
      handler: (_arguments, context) => {
        context.log("info", "diagnostic", {
          token: "must-not-leak",
          nested: {
            password: "also-secret",
            apiKey: "camel-api-secret",
            accessToken: "camel-access-secret",
            refresh_token: "refresh-secret",
            clientSecret: "client-secret",
            privateKey: "private-key-secret",
            safe: `failure bmp_pair_${"s".repeat(43)} and Bearer opaqueCredential123`,
            message: "request failed apiKey=assignment-secret",
          },
        });
        return { content: [] };
      },
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
    });
    await vi.waitFor(() =>
      expect(app.getLogs().some((entry) => entry.event === "handler.diagnostic")).toBe(true),
    );

    const serialized = JSON.stringify(app.getLogs());
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("also-secret");
    expect(serialized).not.toContain("camel-api-secret");
    expect(serialized).not.toContain("camel-access-secret");
    expect(serialized).not.toContain("refresh-secret");
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("private-key-secret");
    expect(serialized).not.toContain("assignment-secret");
    expect(serialized).not.toContain("bmp_pair_");
    expect(serialized).not.toContain("opaqueCredential123");
    expect(serialized).toContain("[REDACTED]");
    expect(app.getLogs().length).toBeLessThanOrEqual(5);
  });

  it("redacts URL userinfo and credential query parameters including encoded names", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    const tool = app.tool({
      name: "url.log.tool",
      inputSchema: { type: "object" },
      handler: (_arguments, context) => {
        context.log("info", "url-diagnostic", {
          urls: [
            "https://alice:user-password@example.test/cb?access_token=plain-secret&safe=yes",
            "https://example.test/cb?ACCESS_TOKEN=encoded%2Dsecret",
            "https://example.test/cb?api%5Fkey=encoded-api-secret",
            "/callback?code=oauth-secret&safe=yes",
          ],
        });
        return { content: [] };
      },
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
    });
    await vi.waitFor(() =>
      expect(app.getLogs().some((entry) => entry.event === "handler.url-diagnostic")).toBe(true),
    );

    const serialized = JSON.stringify(app.getLogs());
    for (const secret of [
      "alice",
      "user-password",
      "plain-secret",
      "encoded%2Dsecret",
      "encoded-api-secret",
      "oauth-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("safe=yes");
    expect(serialized).toContain("REDACTED");
  });

  it("does not expose mutable references to internal nested log data", async () => {
    const bridge = new FakeBridge();
    const loggerEntries: Array<{
      data?: Readonly<Record<string, unknown>>;
      event: string;
    }> = [];
    const app = createApp(bridge, {
      logger: (entry) => loggerEntries.push(entry),
    });
    const tool = app.tool({
      name: "mutable.log.tool",
      inputSchema: { type: "object" },
      handler: (_arguments, context) => {
        context.log("info", "mutable", { nested: { value: "safe" } });
        return { content: [] };
      },
    });
    await app.connect();
    await tool.ready;
    bridge.sendInvoke({
      registrationId: tool.id,
      operation: { kind: "tool.call", arguments: {} },
    });
    await vi.waitFor(() =>
      expect(app.getLogs().some(({ event }) => event === "handler.mutable")).toBe(true),
    );

    const returned = app.getLogs().find(({ event }) => event === "handler.mutable") as {
      data?: { nested?: { value?: string; apiKey?: string } };
    };
    const callback = loggerEntries.find(({ event }) => event === "handler.mutable") as {
      data?: { nested?: { value?: string; apiKey?: string } };
    };
    const returnedNested = returned.data?.nested;
    const callbackNested = callback.data?.nested;
    expect(returned).not.toBe(callback);
    expect(returnedNested).not.toBe(callbackNested);
    expect(Object.isFrozen(returned)).toBe(true);
    expect(Object.isFrozen(returned.data)).toBe(true);
    expect(Object.isFrozen(returnedNested)).toBe(true);
    expect(Object.isFrozen(callback)).toBe(true);
    expect(Object.isFrozen(callback.data)).toBe(true);
    expect(Object.isFrozen(callbackNested)).toBe(true);
    expect(Reflect.set(returnedNested ?? {}, "apiKey", "returned-secret")).toBe(false);
    expect(Reflect.set(callbackNested ?? {}, "apiKey", "callback-secret")).toBe(false);

    const fresh = JSON.stringify(app.getLogs());
    expect(fresh).not.toContain("returned-secret");
    expect(fresh).not.toContain("callback-secret");
    expect(fresh).toContain('"value":"safe"');
  });

  it("redacts secrets in remote errors, details, and WebSocket close reasons", async () => {
    const bridge = new FakeBridge();
    const app = createApp(bridge);
    await app.connect();
    const remoteToken = `bmp_resume_${"r".repeat(43)}`;
    bridge.socket.receive(
      createBridgeMessage("error", {
        sessionId: bridge.currentSessionId(),
        code: "INTERNAL_ERROR",
        message: `Remote failure ${remoteToken}`,
        retryable: false,
        details: { diagnostic: `Bearer remoteCredential123` },
      }),
    );
    await vi.waitFor(() => expect(app.getSnapshot().lastError?.code).toBe("REMOTE_ERROR"));
    expect(JSON.stringify(app.getSnapshot())).not.toContain(remoteToken);
    expect(JSON.stringify(app.getLogs())).not.toContain("remoteCredential123");

    bridge.socket.close(1008, `closed ${remoteToken} Bearer closeCredential123`);
    await vi.waitFor(() => expect(app.connectionState).toBe("disconnected"));
    const diagnostics = JSON.stringify({ snapshot: app.getSnapshot(), logs: app.getLogs() });
    expect(diagnostics).not.toContain(remoteToken);
    expect(diagnostics).not.toContain("closeCredential123");
  });
});

type ToolResultNever = { content: [] };
