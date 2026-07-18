import {
  createBridgeMessage,
  KNOWN_PROTOCOL_CAPABILITIES,
  PROTOCOL_VERSION,
} from "@browsermcp/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { BrowserMcpBridge } from "../../src/bridge.js";
import { BrowserPeer, testConfig } from "./helpers.js";

async function openSocket(endpoint: string, origin: string): Promise<WebSocket> {
  const socket = new WebSocket(endpoint, { origin });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

function websocketFailure(endpoint: string, origin: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(endpoint, { origin });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("WebSocket unexpectedly opened"));
    });
    socket.once("error", () => undefined);
  });
}

describe("browser authentication and session resume", () => {
  let bridge: BrowserMcpBridge | undefined;
  const peers: BrowserPeer[] = [];

  afterEach(async () => {
    await Promise.allSettled(peers.splice(0).map((peer) => peer.close()));
    await bridge?.close();
    bridge = undefined;
  });

  it("rejects ineligible origins, mismatches, invalid tokens, and pairing replay", async () => {
    const allowed = "https://allowed.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(allowed);

    await expect(websocketFailure(address.browserEndpoint, "http://attacker.test")).resolves.toBe(
      403,
    );

    const mismatch = new BrowserPeer(address.browserEndpoint, allowed);
    peers.push(mismatch);
    await new Promise<void>((resolve, reject) => {
      mismatch.socket.once("open", () => resolve());
      mismatch.socket.once("error", reject);
    });
    mismatch.send(
      createBridgeMessage("connect", {
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
        auth: { kind: "pairing", token: pairing.token },
        app: mismatch.app,
        origin: "https://different.example.test",
        runtime: mismatch.runtime,
      }),
    );
    await expect(mismatch.waitFor("error")).resolves.toMatchObject({
      payload: { code: "ORIGIN_NOT_ALLOWED" },
    });

    const first = new BrowserPeer(address.browserEndpoint, allowed);
    peers.push(first);
    await first.open({ kind: "pairing", token: pairing.token });

    const replay = new BrowserPeer(address.browserEndpoint, allowed);
    peers.push(replay);
    await new Promise<void>((resolve, reject) => {
      replay.socket.once("open", () => resolve());
      replay.socket.once("error", reject);
    });
    replay.send(
      createBridgeMessage("connect", {
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
        auth: { kind: "pairing", token: pairing.token },
        app: { ...replay.app, id: "replay-app" },
        origin: allowed,
        runtime: { ...replay.runtime, id: "runtime-replay", instanceId: "tab-replay" },
      }),
    );
    await expect(replay.waitFor("error")).resolves.toMatchObject({
      payload: { code: "AUTH_INVALID" },
    });

    const malformed = new BrowserPeer(address.browserEndpoint, allowed);
    peers.push(malformed);
    await new Promise<void>((resolve, reject) => {
      malformed.socket.once("open", () => resolve());
      malformed.socket.once("error", reject);
    });
    malformed.socket.send('{"type":"connect","unknown":true}');
    await expect(malformed.waitFor("error")).resolves.toMatchObject({
      payload: { code: "INVALID_MESSAGE" },
    });

    const unsupportedPairing = bridge.issuePairingToken(allowed);
    const unsupported = new BrowserPeer(address.browserEndpoint, allowed);
    peers.push(unsupported);
    await new Promise<void>((resolve, reject) => {
      unsupported.socket.once("open", () => resolve());
      unsupported.socket.once("error", reject);
    });
    unsupported.send(
      createBridgeMessage(
        "connect",
        {
          supportedVersions: ["2.0.0"],
          capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
          auth: { kind: "pairing", token: unsupportedPairing.token },
          app: { ...unsupported.app, id: "future-app" },
          origin: allowed,
          runtime: { ...unsupported.runtime, id: "future-runtime", instanceId: "future-tab" },
        },
        { version: "2.0.0" },
      ),
    );
    await expect(unsupported.waitFor("error")).resolves.toMatchObject({
      payload: { code: "VERSION_UNSUPPORTED" },
    });

    const compatible = new BrowserPeer(address.browserEndpoint, allowed);
    peers.push(compatible);
    await new Promise<void>((resolve, reject) => {
      compatible.socket.once("open", () => resolve());
      compatible.socket.once("error", reject);
    });
    compatible.send(
      createBridgeMessage("connect", {
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
        auth: { kind: "pairing", token: unsupportedPairing.token },
        app: { ...compatible.app, id: "future-app" },
        origin: allowed,
        runtime: {
          ...compatible.runtime,
          id: "future-runtime",
          instanceId: "future-tab",
        },
      }),
    );
    await expect(compatible.waitFor("welcome")).resolves.toMatchObject({
      payload: { selectedVersion: PROTOCOL_VERSION },
    });
  });

  it("holds a credential-free Origin request until the admin approves or rejects it", async () => {
    const origin = "https://approval.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const base = `http://127.0.0.1:${address.port}`;

    const approved = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(approved);
    const approval = await approved.requestApproval();
    expect(approval.payload).toMatchObject({ origin, requestId: expect.any(String) });
    expect(bridge.state.apps as readonly unknown[]).toHaveLength(0);
    expect(bridge.state.pairingRequests).toEqual([
      expect.objectContaining({
        origin,
        requestId: approval.payload.requestId,
        app: approved.app,
        runtime: approved.runtime,
      }),
    ]);
    expect(JSON.stringify(bridge.state.pairingRequests)).not.toContain("token");

    const accepted = await fetch(
      `${base}/api/pairing-requests/${encodeURIComponent(approval.payload.requestId)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${address.adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ decision: "approve" }),
      },
    );
    expect(accepted.status).toBe(204);
    await expect(approved.waitFor("welcome")).resolves.toMatchObject({
      payload: { selectedVersion: PROTOCOL_VERSION },
    });
    expect(bridge.state.apps).toEqual([expect.objectContaining({ origin })]);
    expect(bridge.state.pairingRequests).toEqual([]);

    await approved.close();
    const rejected = new BrowserPeer(address.browserEndpoint, "https://rejected.example.test");
    peers.push(rejected);
    const rejection = await rejected.requestApproval();
    const denied = await fetch(
      `${base}/api/pairing-requests/${encodeURIComponent(rejection.payload.requestId)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${address.adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ decision: "reject" }),
      },
    );
    expect(denied.status).toBe(204);
    await expect(rejected.waitFor("error")).resolves.toMatchObject({
      payload: { code: "APPROVAL_REJECTED", retryable: false },
    });
    expect(bridge.state.pairingRequests).toEqual([]);
  });

  it("expires an undecided Origin request without establishing a session", async () => {
    const origin = "https://approval-expiry.example.test";
    bridge = new BrowserMcpBridge(
      testConfig({ limits: { ...testConfig().limits, pairingTokenTtlMs: 25 } }),
    );
    const address = await bridge.start();
    const peer = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(peer);
    await peer.requestApproval();

    await expect(peer.waitFor("error")).resolves.toMatchObject({
      payload: { code: "APPROVAL_EXPIRED", retryable: false },
    });
    expect(bridge.state.apps).toEqual([]);
    expect(bridge.state.pairingRequests).toEqual([]);
  });

  it("rotates a short-lived resume token and rejects replay or identity mismatch", async () => {
    const origin = "https://resume.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    const first = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(first);
    const firstWelcome = await first.open({ kind: "pairing", token: pairing.token });
    await first.close();

    const resumed = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(resumed);
    const secondWelcome = await resumed.open({
      kind: "resume",
      sessionId: firstWelcome.payload.session.id,
      token: firstWelcome.payload.session.resumeToken,
    });
    expect(secondWelcome.payload.session.id).toBe(firstWelcome.payload.session.id);
    expect(secondWelcome.payload.session.resumeToken).not.toBe(
      firstWelcome.payload.session.resumeToken,
    );
    await resumed.close();

    const replay = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(replay);
    await new Promise<void>((resolve, reject) => {
      replay.socket.once("open", () => resolve());
      replay.socket.once("error", reject);
    });
    replay.send(
      createBridgeMessage("connect", {
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
        auth: {
          kind: "resume",
          sessionId: firstWelcome.payload.session.id,
          token: firstWelcome.payload.session.resumeToken,
        },
        app: replay.app,
        origin,
        runtime: replay.runtime,
      }),
    );
    await expect(replay.waitFor("error")).resolves.toMatchObject({
      payload: { code: "SESSION_RESUME_REJECTED" },
    });

    const mismatch = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(mismatch);
    await new Promise<void>((resolve, reject) => {
      mismatch.socket.once("open", () => resolve());
      mismatch.socket.once("error", reject);
    });
    mismatch.send(
      createBridgeMessage("connect", {
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
        auth: {
          kind: "resume",
          sessionId: secondWelcome.payload.session.id,
          token: secondWelcome.payload.session.resumeToken,
        },
        app: { ...mismatch.app, id: "impostor" },
        origin,
        runtime: mismatch.runtime,
      }),
    );
    await expect(mismatch.waitFor("error")).resolves.toMatchObject({
      payload: { code: "SESSION_RESUME_REJECTED" },
    });

    const correct = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(correct);
    const recovered = await correct.open({
      kind: "resume",
      sessionId: secondWelcome.payload.session.id,
      token: secondWelcome.payload.session.resumeToken,
    });
    expect(recovered.payload.session.id).toBe(secondWelcome.payload.session.id);
  });

  it("atomically replaces a half-open connection after authenticated resume", async () => {
    const origin = "https://resume-takeover.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    const first = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(first);
    const firstWelcome = await first.open({ kind: "pairing", token: pairing.token });
    await first.register(firstWelcome.payload.session.id, {
      kind: "tool",
      id: "half-open-tool",
      name: "half_open_tool",
      inputSchema: {},
    });

    const replaced = first.waitFor("disconnect");
    const resumed = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(resumed);
    const secondWelcome = await resumed.open({
      kind: "resume",
      sessionId: firstWelcome.payload.session.id,
      token: firstWelcome.payload.session.resumeToken,
    });

    await expect(replaced).resolves.toMatchObject({
      payload: { code: "SESSION_REPLACED", canResume: false },
    });
    expect(secondWelcome.payload.session.id).toBe(firstWelcome.payload.session.id);
    expect(secondWelcome.payload.session.resumeToken).not.toBe(
      firstWelcome.payload.session.resumeToken,
    );
    expect(bridge.state.apps as readonly unknown[]).toHaveLength(1);
    expect(
      (bridge.state.capabilities as { readonly tools: readonly unknown[] }).tools,
    ).toHaveLength(0);
  });

  it("rejects a v1 connection missing required protocol capabilities before consuming auth", async () => {
    const origin = "https://capabilities.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    const subset = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(subset);
    await new Promise<void>((resolve, reject) => {
      subset.socket.once("open", () => resolve());
      subset.socket.once("error", reject);
    });
    subset.send(
      createBridgeMessage("connect", {
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: ["tools"],
        auth: { kind: "pairing", token: pairing.token },
        app: subset.app,
        origin,
        runtime: subset.runtime,
      }),
    );
    await expect(subset.waitFor("error")).resolves.toMatchObject({
      payload: { code: "CAPABILITY_UNSUPPORTED", retryable: false },
    });

    const complete = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(complete);
    await expect(complete.open({ kind: "pairing", token: pairing.token })).resolves.toMatchObject({
      type: "welcome",
    });
  });

  it("closes a browser that exceeds the configured message limit", async () => {
    const origin = "https://payload.example.test";
    bridge = new BrowserMcpBridge(
      testConfig({ limits: { ...testConfig().limits, maxWebSocketPayloadBytes: 1_024 } }),
    );
    const address = await bridge.start();
    bridge.issuePairingToken(origin);
    const socket = new WebSocket(address.browserEndpoint, { origin });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const closeCode = new Promise<number>((resolve) => {
      socket.once("close", (code) => resolve(code));
    });
    socket.send("x".repeat(1_025));
    await expect(closeCode).resolves.toBe(1009);
  });

  it("survives an allowed-origin pre-auth message with a huge unknown key", async () => {
    const origin = "https://malformed.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    const socket = await openSocket(address.browserEndpoint, origin);
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    const errorMessage = new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once("message", (data) => {
        try {
          resolve(JSON.parse(data.toString()) as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
    });
    const validConnect = createBridgeMessage("connect", {
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: [...KNOWN_PROTOCOL_CAPABILITIES],
      auth: { kind: "pairing", token: pairing.token },
      app: { id: "oversized-key-app", name: "Oversized Key", version: "1.0.0" },
      origin,
      runtime: { id: "oversized-runtime", instanceId: "oversized-tab" },
    });
    socket.send(JSON.stringify({ ...validConnect, ["x".repeat(20_000)]: true }));
    const response = await errorMessage;
    expect(response.type).toBe("error");
    const payload = response.payload as { code?: unknown; message?: unknown };
    expect(payload.code).toBe("INVALID_MESSAGE");
    expect(typeof payload.message).toBe("string");
    expect(String(payload.message).length).toBeLessThanOrEqual(512);
    expect(String(payload.message)).not.toContain("x".repeat(100));
    await closed;

    const valid = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(valid);
    await expect(valid.open({ kind: "pairing", token: pairing.token })).resolves.toMatchObject({
      type: "welcome",
    });
    await expect(fetch(`${address.statusEndpoint}health`)).resolves.toMatchObject({ status: 200 });
  });

  it("enforces configured registration limits over the real browser transport", async () => {
    const origin = "https://registration-limit.example.test";
    bridge = new BrowserMcpBridge(
      testConfig({
        limits: {
          ...testConfig().limits,
          maxRegistrationsPerRuntime: 1,
          maxRegistrationsTotal: 1,
        },
      }),
    );
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    const peer = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(peer);
    const welcome = await peer.open({ kind: "pairing", token: pairing.token });
    await peer.register(welcome.payload.session.id, {
      kind: "tool",
      id: "first",
      name: "first",
      inputSchema: {},
    });
    peer.send(
      createBridgeMessage("register", {
        sessionId: welcome.payload.session.id,
        registration: {
          kind: "tool",
          id: "second",
          name: "second",
          inputSchema: {},
        },
      }),
    );
    await expect(peer.waitFor("error")).resolves.toMatchObject({
      payload: { code: "REGISTRATION_REJECTED", retryable: false },
    });
    expect(bridge.state).toMatchObject({
      registryUsage: { registrations: 1 },
      capabilities: { tools: expect.arrayContaining([expect.stringMatching(/__first$/)]) },
    });
  });

  it("marks Bridge shutdown disconnects as non-resumable", async () => {
    const origin = "https://shutdown.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    const peer = new BrowserPeer(address.browserEndpoint, origin);
    peers.push(peer);
    await peer.open({ kind: "pairing", token: pairing.token });
    const closing = bridge.close();
    await expect(peer.waitFor("disconnect")).resolves.toMatchObject({
      payload: { code: "BRIDGE_STOPPING", canResume: false },
    });
    await closing;
    bridge = undefined;
  });
});
