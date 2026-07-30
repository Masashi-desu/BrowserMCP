import {
  Client,
  type McpSubscription,
  ProtocolErrorCode,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserMcpBridge } from "../../src/bridge.js";
import { MCP_TOKEN, testConfig } from "./helpers.js";

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error("Condition did not become true");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function subscriptionCount(bridge: BrowserMcpBridge): number {
  const mcp = bridge.state.mcp as { subscriptions?: unknown };
  return typeof mcp.subscriptions === "number" ? mcp.subscriptions : -1;
}

function modernClient(name: string): Client {
  return new Client(
    { name, version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
}

function transport(endpoint: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
  });
}

describe("modern stateless MCP endpoint", () => {
  let bridge: BrowserMcpBridge | undefined;
  const clients: Client[] = [];
  const subscriptions: McpSubscription[] = [];

  afterEach(async () => {
    await Promise.allSettled(subscriptions.splice(0).map((subscription) => subscription.close()));
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    await bridge?.close();
    bridge = undefined;
  });

  it("serves 2026-07-28 requests without sessions and rejects legacy transport verbs", async () => {
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const first = modernClient("first-stateless-client");
    const second = modernClient("second-stateless-client");
    const firstTransport = transport(address.mcpEndpoint);
    const secondTransport = transport(address.mcpEndpoint);
    clients.push(first, second);

    await first.connect(firstTransport);
    await second.connect(secondTransport);
    await expect(first.listTools()).resolves.toMatchObject({ tools: [] });
    await expect(second.listResources()).resolves.toMatchObject({ resources: [] });
    expect(firstTransport.sessionId).toBeUndefined();
    expect(secondTransport.sessionId).toBeUndefined();
    expect(bridge.state).toMatchObject({
      sessions: { browser: 0 },
      mcp: {
        protocolVersion: "2026-07-28",
        stateless: true,
        subscriptions: 0,
      },
    });

    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(address.mcpEndpoint, {
        method,
        headers: { authorization: `Bearer ${MCP_TOKEN}` },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }

    const legacy = await fetch(address.mcpEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${MCP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-client", version: "1.0.0" },
        },
      }),
    });
    expect(legacy.status).toBe(400);
    await expect(legacy.json()).resolves.toMatchObject({
      error: {
        code: ProtocolErrorCode.UnsupportedProtocolVersion,
        data: { supported: ["2026-07-28"] },
      },
    });
  });

  it("bounds durable notification subscriptions independently from requests", async () => {
    bridge = new BrowserMcpBridge(
      testConfig({
        limits: {
          ...testConfig().limits,
          maxMcpSubscriptions: 1,
        },
      }),
    );
    const address = await bridge.start();
    const first = modernClient("first-subscription-client");
    const second = modernClient("second-subscription-client");
    clients.push(first, second);
    await first.connect(transport(address.mcpEndpoint));
    await second.connect(transport(address.mcpEndpoint));

    const firstSubscription = await first.listen({ toolsListChanged: true });
    subscriptions.push(firstSubscription);
    await waitFor(() => (bridge ? subscriptionCount(bridge) === 1 : false));
    await expect(second.listTools()).resolves.toMatchObject({ tools: [] });
    await expect(second.listen({ toolsListChanged: true })).rejects.toMatchObject({
      code: ProtocolErrorCode.InternalError,
    });

    await firstSubscription.close();
    subscriptions.splice(subscriptions.indexOf(firstSubscription), 1);
    await waitFor(() => (bridge ? subscriptionCount(bridge) === 0 : false));
    const replacement = await second.listen({ toolsListChanged: true });
    subscriptions.push(replacement);
    await waitFor(() => (bridge ? subscriptionCount(bridge) === 1 : false));
  });
});
