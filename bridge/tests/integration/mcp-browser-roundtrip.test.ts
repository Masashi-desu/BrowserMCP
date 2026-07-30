import { createBridgeMessage } from "@browsermcp/protocol";
import {
  Client,
  ProtocolErrorCode,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserMcpBridge } from "../../src/bridge.js";
import { BrowserPeer, MCP_TOKEN, testConfig } from "./helpers.js";

function modernClient(name: string): Client {
  return new Client(
    { name, version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
}

describe("MCP → Bridge → browser round trip", () => {
  let bridge: BrowserMcpBridge | undefined;
  let browser: BrowserPeer | undefined;
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await bridge?.close();
    bridge = undefined;
    browser = undefined;
    client = undefined;
    transport = undefined;
  });

  it("discovers MCP, lists dynamic primitives, invokes all kinds, and unregisters", async () => {
    const origin = "https://runtime.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    browser = new BrowserPeer(address.browserEndpoint, origin);
    const welcome = await browser.open({ kind: "pairing", token: pairing.token });
    const sessionId = welcome.payload.session.id;

    await browser.register(sessionId, {
      kind: "tool",
      id: "echo-tool",
      name: "echo",
      description: "Echo arguments in the browser",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
      outputSchema: {
        type: "array",
        items: { type: "string" },
      },
    });
    await browser.register(sessionId, {
      kind: "resource",
      id: "guide-resource",
      name: "Guide",
      description: "Browser-resident guide",
      uri: "docs://guide",
      mimeType: "text/plain",
    });
    await browser.register(sessionId, {
      kind: "prompt",
      id: "explain-prompt",
      name: "explain",
      description: "Explain a topic",
      arguments: [{ name: "topic", required: true }],
    });
    expect(bridge.state).toMatchObject({
      apps: [{ id: "test-app", origin }],
      sessions: { browser: 1 },
      mcp: { protocolVersion: "2026-07-28", stateless: true },
    });

    client = modernClient("bridge-test-client");
    transport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    await client.connect(transport);
    expect(transport.sessionId).toBeUndefined();

    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]?.name).toMatch(/^test-app_[a-f0-9]{16}_[a-f0-9]{16}__echo$/);
    const toolName = tools.tools[0]?.name;
    if (!toolName) throw new Error("Tool was not listed");

    const toolCall = client.callTool({ name: toolName, arguments: { value: "hello" } });
    const toolInvoke = await browser.waitFor("invoke");
    expect(toolInvoke.payload.operation).toEqual({
      kind: "tool.call",
      arguments: { value: "hello" },
    });
    browser.send(
      createBridgeMessage("result", {
        sessionId,
        invocationId: toolInvoke.payload.invocationId,
        output: {
          kind: "tool",
          content: [{ type: "text", text: "hello from browser" }],
          structuredContent: ["hello"],
        },
      }),
    );
    await expect(toolCall).resolves.toMatchObject({
      content: [{ type: "text", text: "hello from browser" }],
      structuredContent: ["hello"],
    });

    const resources = await client.listResources();
    expect(resources.resources).toHaveLength(1);
    const resourceUri = resources.resources[0]?.uri;
    if (!resourceUri) throw new Error("Resource was not listed");
    const resourceRead = client.readResource({ uri: resourceUri });
    const resourceInvoke = await browser.waitFor("invoke");
    expect(resourceInvoke.payload.operation).toEqual({
      kind: "resource.read",
      uri: "docs://guide",
    });
    browser.send(
      createBridgeMessage("result", {
        sessionId,
        invocationId: resourceInvoke.payload.invocationId,
        output: {
          kind: "resource",
          contents: [{ uri: "docs://guide", mimeType: "text/plain", text: "Guide text" }],
        },
      }),
    );
    await expect(resourceRead).resolves.toMatchObject({
      contents: [{ uri: resourceUri, text: "Guide text" }],
    });

    const mismatchedResourceRead = client.readResource({ uri: resourceUri });
    const mismatchedInvoke = await browser.waitFor("invoke");
    browser.send(
      createBridgeMessage("result", {
        sessionId,
        invocationId: mismatchedInvoke.payload.invocationId,
        output: {
          kind: "resource",
          contents: [{ uri: "docs://other", text: "Wrong resource" }],
        },
      }),
    );
    await expect(mismatchedResourceRead).rejects.toThrow(/unexpected URI/);
    await expect(client.listResources()).resolves.toMatchObject({
      resources: [{ uri: resourceUri }],
    });

    const prompts = await client.listPrompts();
    expect(prompts.prompts).toHaveLength(1);
    const promptName = prompts.prompts[0]?.name;
    if (!promptName) throw new Error("Prompt was not listed");
    const promptGet = client.getPrompt({ name: promptName, arguments: { topic: "security" } });
    const promptInvoke = await browser.waitFor("invoke");
    expect(promptInvoke.payload.operation).toEqual({
      kind: "prompt.get",
      arguments: { topic: "security" },
    });
    browser.send(
      createBridgeMessage("result", {
        sessionId,
        invocationId: promptInvoke.payload.invocationId,
        output: {
          kind: "prompt",
          description: "Explain security",
          messages: [{ role: "user", content: { type: "text", text: "Explain security" } }],
        },
      }),
    );
    await expect(promptGet).resolves.toMatchObject({
      description: "Explain security",
      messages: [{ role: "user", content: { type: "text", text: "Explain security" } }],
    });

    const toolListChanged = new Promise<void>((resolve) => {
      client?.setNotificationHandler("notifications/tools/list_changed", async () => resolve());
    });
    await client.listen({ toolsListChanged: true });
    browser.send(createBridgeMessage("unregister", { sessionId, registrationId: "echo-tool" }));
    await browser.waitFor("unregistered");
    await toolListChanged;
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
    await expect(client.callTool({ name: toolName, arguments: {} })).rejects.toMatchObject({
      code: ProtocolErrorCode.InvalidParams,
    });
    await expect(
      client.readResource({ uri: "browsermcp://missing/resource" }),
    ).rejects.toMatchObject({ code: ProtocolErrorCode.InvalidParams });
    await expect(client.getPrompt({ name: "missing_prompt" })).rejects.toMatchObject({
      code: ProtocolErrorCode.InvalidParams,
    });
  });

  it("maps browser errors, timeout, cancellation, and disconnect to MCP-safe tool errors", async () => {
    const origin = "https://errors.example.test";
    bridge = new BrowserMcpBridge(
      testConfig({ limits: { ...testConfig().limits, browserRequestTimeoutMs: 80 } }),
    );
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    browser = new BrowserPeer(address.browserEndpoint, origin);
    const welcome = await browser.open({ kind: "pairing", token: pairing.token });
    const sessionId = welcome.payload.session.id;
    await browser.register(sessionId, {
      kind: "tool",
      id: "fail-tool",
      name: "fail",
      inputSchema: {},
    });

    client = modernClient("bridge-error-client");
    transport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    await client.connect(transport);
    const name = (await client.listTools()).tools[0]?.name;
    if (!name) throw new Error("Tool was not listed");

    const browserErrorCall = client.callTool({ name, arguments: {} });
    const failedInvoke = await browser.waitFor("invoke");
    const leakedSecret = `bmp_pair_${"s".repeat(43)}`;
    browser.send(
      createBridgeMessage("error", {
        sessionId,
        invocationId: failedInvoke.payload.invocationId,
        code: "HANDLER_ERROR",
        message: `Browser handler failed with ${leakedSecret} and Bearer eyJhbGciOiJIUzI1Ni.payload.signature`,
        retryable: false,
      }),
    );
    const browserErrorResult = await browserErrorCall;
    expect(browserErrorResult).toMatchObject({ isError: true });
    expect(JSON.stringify(browserErrorResult)).not.toContain(leakedSecret);
    expect(JSON.stringify(browserErrorResult)).not.toContain("eyJhbGci");
    expect(JSON.stringify(bridge.state)).not.toContain(leakedSecret);
    expect(JSON.stringify(bridge.state)).not.toContain("eyJhbGci");

    const controller = new AbortController();
    const cancelledCall = client.callTool(
      { name, arguments: {} },
      {
        signal: controller.signal,
      },
    );
    const cancelledRejection = expect(cancelledCall).rejects.toThrow();
    const cancelledInvoke = await browser.waitFor("invoke");
    controller.abort();
    const forwardedCancel = await browser.waitFor("cancel");
    expect(forwardedCancel.payload.invocationId).toBe(cancelledInvoke.payload.invocationId);
    await cancelledRejection;

    const timedOutCall = client.callTool({ name, arguments: {} });
    await browser.waitFor("invoke");
    const cancel = await browser.waitFor("cancel");
    expect(cancel.payload.reason).toMatch(/timed out/);
    await expect(timedOutCall).resolves.toMatchObject({ isError: true });

    const disconnectedCall = client.callTool({ name, arguments: {} });
    await browser.waitFor("invoke");
    await browser.close();
    browser = undefined;
    await expect(disconnectedCall).resolves.toMatchObject({ isError: true });
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
    await expect(client.callTool({ name, arguments: {} })).rejects.toThrow(/No connected browser/);
  });

  it("filters malformed browser schemas and annotations at the standard MCP boundary", async () => {
    const origin = "https://metadata.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    browser = new BrowserPeer(address.browserEndpoint, origin);
    const welcome = await browser.open({ kind: "pairing", token: pairing.token });
    await browser.register(welcome.payload.session.id, {
      kind: "tool",
      id: "malformed-metadata",
      name: "metadata",
      inputSchema: {
        properties: "not-an-object",
        required: "not-an-array",
      },
      outputSchema: {
        properties: { valid: { type: "string" }, invalid: "not-a-schema" },
        required: ["valid", 42],
      },
      annotations: {
        readOnlyHint: "not-a-boolean",
        destructiveHint: true,
        applicationSpecific: { unsafe: true },
      },
    });
    await browser.register(welcome.payload.session.id, {
      kind: "resource",
      id: "metadata-resource",
      name: "metadata_resource",
      uri: "docs://metadata",
      annotations: {
        audience: ["user", "unsupported-role"],
        priority: 0.8,
        lastModified: "not-a-timestamp",
      },
    });

    client = modernClient("metadata-test-client");
    transport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(1);
    expect(listed.tools[0]?.inputSchema).toEqual({ type: "object" });
    expect(listed.tools[0]?.outputSchema).toMatchObject({
      properties: { valid: { type: "string" } },
      required: ["valid"],
    });
    expect(listed.tools[0]?.outputSchema).not.toHaveProperty("type");
    expect(listed.tools[0]?.annotations).toEqual({ destructiveHint: true });
    const resources = await client.listResources();
    expect(resources.resources[0]?.annotations).toEqual({ audience: ["user"], priority: 0.8 });
  });

  it("turns malformed browser binary output into a safe error without breaking MCP", async () => {
    const origin = "https://binary-output.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    browser = new BrowserPeer(address.browserEndpoint, origin);
    const welcome = await browser.open({ kind: "pairing", token: pairing.token });
    await browser.register(welcome.payload.session.id, {
      kind: "tool",
      id: "binary-tool",
      name: "binary",
      inputSchema: {},
    });
    client = modernClient("binary-output-client");
    transport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    await client.connect(transport);
    const name = (await client.listTools()).tools[0]?.name;
    if (!name) throw new Error("Tool was not listed");

    const call = client.callTool({ name, arguments: {} });
    const invocation = await browser.waitFor("invoke");
    const malformed = createBridgeMessage("result", {
      sessionId: welcome.payload.session.id,
      invocationId: invocation.payload.invocationId,
      output: {
        kind: "tool",
        content: [{ type: "image", data: "eA==", mimeType: "image/png" }],
      },
    });
    const firstContent = (
      malformed.payload.output as {
        content: Array<{ data: string }>;
      }
    ).content[0];
    if (!firstContent) throw new Error("Expected image content");
    firstContent.data = "x";
    browser.socket.send(JSON.stringify(malformed));
    await expect(call).resolves.toMatchObject({ isError: true });
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
    await expect(fetch(`${address.statusEndpoint}health`)).resolves.toMatchObject({ status: 200 });
  });

  it("coalesces browser registration churn into bounded list_changed notifications", async () => {
    const origin = "https://churn.example.test";
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const pairing = bridge.issuePairingToken(origin);
    browser = new BrowserPeer(address.browserEndpoint, origin);
    const welcome = await browser.open({ kind: "pairing", token: pairing.token });

    client = modernClient("churn-test-client");
    transport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    });
    await client.connect(transport);
    let notifications = 0;
    client.setNotificationHandler("notifications/tools/list_changed", async () => {
      notifications += 1;
    });
    await client.listen({ toolsListChanged: true });

    for (let index = 0; index < 20; index += 1) {
      browser.send(
        createBridgeMessage("register", {
          sessionId: welcome.payload.session.id,
          registration: {
            kind: "tool",
            id: `tool-${index}`,
            name: `tool-${index}`,
            inputSchema: {},
          },
        }),
      );
    }
    for (let index = 0; index < 20; index += 1) {
      browser.send(
        createBridgeMessage("unregister", {
          sessionId: welcome.payload.session.id,
          registrationId: `tool-${index}`,
        }),
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(notifications).toBeGreaterThanOrEqual(1);
    expect(notifications).toBeLessThanOrEqual(4);
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
  });
});
