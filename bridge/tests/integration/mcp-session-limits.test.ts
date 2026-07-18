import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

function mcpSessionCount(bridge: BrowserMcpBridge): number {
  const sessions = bridge.state.sessions as { mcp?: unknown };
  return typeof sessions.mcp === "number" ? sessions.mcp : -1;
}

describe("MCP session resource limits", () => {
  let bridge: BrowserMcpBridge | undefined;
  const clients: Client[] = [];
  const transports: StreamableHTTPClientTransport[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      transports.map((transport) => transport.terminateSession().catch(() => undefined)),
    );
    await Promise.allSettled(clients.map((client) => client.close()));
    await bridge?.close();
    bridge = undefined;
    clients.length = 0;
    transports.length = 0;
  });

  it("evicts abandoned idle sessions and permits initialization after reaching the cap", async () => {
    bridge = new BrowserMcpBridge(
      testConfig({
        limits: {
          ...testConfig().limits,
          maxMcpSessions: 1,
          mcpSessionIdleTtlMs: 40,
          mcpSessionSweepIntervalMs: 10,
        },
      }),
    );
    const address = await bridge.start();
    const firstClient = new Client({ name: "abandoned-client", version: "1.0.0" });
    const firstTransport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    clients.push(firstClient);
    transports.push(firstTransport);
    await firstClient.connect(firstTransport);
    expect(mcpSessionCount(bridge)).toBe(1);
    // Simulate a crashed client: close its local transport without MCP DELETE.
    await firstClient.close();

    await waitFor(() => (bridge ? mcpSessionCount(bridge) === 0 : false));

    const secondClient = new Client({ name: "replacement-client", version: "1.0.0" });
    const secondTransport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    clients.push(secondClient);
    transports.push(secondTransport);
    await expect(secondClient.connect(secondTransport)).resolves.toBeUndefined();
    expect(mcpSessionCount(bridge)).toBe(1);
  });

  it("does not evict a session while its standalone SSE request is active", async () => {
    bridge = new BrowserMcpBridge(
      testConfig({
        limits: {
          ...testConfig().limits,
          maxMcpSessions: 1,
          mcpSessionIdleTtlMs: 40,
          mcpSessionSweepIntervalMs: 10,
        },
      }),
    );
    const address = await bridge.start();
    const client = new Client({ name: "sse-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    clients.push(client);
    transports.push(transport);
    await client.connect(transport);
    if (!transport.sessionId) throw new Error("MCP session was not initialized");

    // The SDK client maintains a standalone GET/SSE request for notifications.
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(mcpSessionCount(bridge)).toBe(1);

    const capped = await fetch(address.mcpEndpoint, {
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
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "capped-client", version: "1.0.0" },
        },
      }),
    });
    expect(capped.status).toBe(429);

    await client.close();
    await waitFor(() => (bridge ? mcpSessionCount(bridge) === 0 : false));
  });
});
