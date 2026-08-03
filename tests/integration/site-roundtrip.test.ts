import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { BrowserMcpBridge, DEFAULT_LIMITS, LOOPBACK_HOST } from "@browsermcp/bridge";
import { BrowserMCP, type WebSocketLike } from "@browsermcp/web";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  registerSiteCapabilities,
  type SiteRegistration,
} from "../../site/src/browsermcp/registration.js";
import { RubiksCubeBenchmark } from "../../site/src/runtime/rubiks-cube.js";

const ORIGIN = "https://pages.example.test";

async function waitForPairingRequest(bridge: BrowserMcpBridge): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const requests = bridge.state.pairingRequests;
    const candidate = Array.isArray(requests) ? requests[0] : undefined;
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "requestId" in candidate &&
      typeof candidate.requestId === "string"
    ) {
      return candidate.requestId;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the browser Origin approval request");
}

const trustedHttpsFetch =
  (ca: Buffer) =>
  async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    return await new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: init.method ?? "GET",
          headers,
          ca,
          ...(init.signal == null ? {} : { signal: init.signal }),
        },
        (incoming) => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            } else if (value !== undefined) {
              responseHeaders.set(name, value);
            }
          }
          const status = incoming.statusCode ?? 500;
          if (status === 204 || status === 205 || status === 304) {
            incoming.resume();
            resolve(
              new Response(null, {
                status,
                statusText: incoming.statusMessage,
                headers: responseHeaders,
              }),
            );
            return;
          }
          resolve(
            new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
              status,
              statusText: incoming.statusMessage,
              headers: responseHeaders,
            }),
          );
        },
      );
      request.on("error", reject);
      if (typeof init.body === "string" || init.body instanceof Uint8Array) {
        request.write(init.body);
      } else if (init.body !== undefined && init.body !== null) {
        request.destroy(new TypeError("The test HTTPS fetch accepts only string or byte bodies"));
        return;
      }
      request.end();
    });
  };

describe("real /site capability registration round trip", () => {
  it("round-trips the actual /site registrations over trusted WSS from a Pages-like HTTPS Origin", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "browsermcp-site-tls-"));
    const certificateDirectory = join(temporaryDirectory, "tls");
    const tlsScript = fileURLToPath(
      new URL("../../scripts/generate-local-tls.mjs", import.meta.url),
    );
    execFileSync(process.execPath, [tlsScript, certificateDirectory], { stdio: "ignore" });
    const ca = readFileSync(join(certificateDirectory, "ca-cert.pem"));
    const bridge = new BrowserMcpBridge({
      host: LOOPBACK_HOST,
      port: 0,
      allowedOrigins: [],
      tls: {
        certPath: join(certificateDirectory, "localhost-cert.pem"),
        keyPath: join(certificateDirectory, "localhost-key.pem"),
      },
      limits: {
        ...DEFAULT_LIMITS,
        browserHandshakeTimeoutMs: 1_000,
        browserRequestTimeoutMs: 2_000,
      },
    });
    const address = await bridge.start();
    const app = new BrowserMCP({
      appId: "app:browsermcp-site-integration",
      name: "BrowserMCP Site Integration",
      version: "0.1.0",
      bridgeUrl: address.browserEndpoint,
      origin: ORIGIN,
      runtimeId: "runtime:site-integration",
      instanceId: "instance:site-integration",
      reconnect: false,
      webSocketFactory: (url) =>
        new WebSocket(url, { ca, origin: ORIGIN }) as unknown as WebSocketLike,
    });
    let registration: SiteRegistration | undefined;
    const client = new Client(
      { name: "site-roundtrip-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(address.mcpEndpoint), {
      requestInit: { headers: { authorization: `Bearer ${address.mcpToken}` } },
      fetch: trustedHttpsFetch(ca),
    });

    try {
      const rubiksCube = new RubiksCubeBenchmark({
        initialScrambleLength: 0,
        animationDurationMs: 0,
        random: () => 0.5,
      });
      registration = registerSiteCapabilities(app, {
        getPageSnapshot: () => ({
          title: "Tools",
          path: "/docs/tools",
          route: "docs-page",
          docPageId: "tools",
          hash: "tool-registration",
          locale: "en",
          direction: "ltr",
        }),
        getRuntimeSnapshot: () => ({
          origin: ORIGIN,
          pathname: "/BrowserMCP/",
          language: "en",
          online: true,
          userAgent: "BrowserMCP integration test",
          secureContext: true,
          worker: true,
          indexedDb: true,
          webAssembly: true,
        }),
        getConnectionSnapshot: () => app.getSnapshot(),
        getRegistrationSnapshot: () => app.getRegistrations(),
        rubiksCube,
      });
      const connecting = app.connect();
      const requestId = await waitForPairingRequest(bridge);
      const approval = await trustedHttpsFetch(ca)(
        `${address.statusEndpoint}api/pairing-requests/${encodeURIComponent(requestId)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${address.adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ decision: "approve" }),
        },
      );
      expect(approval.status).toBe(204);
      await connecting;
      await registration.ready;

      await client.connect(transport);
      expect(transport.sessionId).toBeUndefined();

      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(24);
      const docsSearch = tools.tools.find(({ name }) => name.endsWith("__docs_search"));
      if (docsSearch === undefined) throw new Error("The site did not publish docs_search");
      expect(docsSearch.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const storagePut = tools.tools.find(({ name }) => name.endsWith("__site_storage_put"));
      expect(storagePut?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });
      const storageGet = tools.tools.find(({ name }) => name.endsWith("__site_storage_get"));
      expect(storageGet?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });
      const cubeApply = tools.tools.find(({ name }) => name.endsWith("__rubiks_cube_apply_moves"));
      if (cubeApply === undefined) throw new Error("The site did not publish the cube benchmark");
      expect(cubeApply.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      const searchResult = await client.callTool({
        name: docsSearch.name,
        arguments: { query: "register a Tool with app.tool", limit: 10 },
      });
      expect(searchResult.isError).not.toBe(true);
      expect(JSON.stringify(searchResult.structuredContent)).toContain("tool-registration");
      expect(JSON.stringify(searchResult.structuredContent)).toContain("/docs/tools");
      const cubeResult = await client.callTool({
        name: cubeApply.name,
        arguments: { moves: "R U R' U'", animated: false },
      });
      expect(cubeResult.isError).not.toBe(true);
      expect(cubeResult.structuredContent).toMatchObject({
        appliedMoves: ["R", "U", "R'", "U'"],
        state: { isSolved: false, faceletOrder: "URFDLB" },
      });

      const resources = await client.listResources();
      expect(resources.resources).toHaveLength(24);
      const toolsPage = resources.resources.find(
        (resource) =>
          (resource._meta as Record<string, unknown> | undefined)?.["browsermcp/sourceUri"] ===
          "browsermcp://docs/page/tools",
      );
      if (toolsPage === undefined) throw new Error("The site did not publish the Tools docs page");
      const resourceResult = await client.readResource({ uri: toolsPage.uri });
      const resourceContent = resourceResult.contents[0];
      if (resourceContent === undefined || !("text" in resourceContent)) {
        throw new Error("The Tools docs resource was not text");
      }
      const resourceText = resourceContent.text;
      const resourcePage = JSON.parse(resourceText) as {
        readonly id?: unknown;
        readonly sections?: readonly { readonly source?: unknown }[];
      };
      expect(resourcePage.id).toBe("tools");
      expect(JSON.stringify(resourcePage.sections)).toContain("docs/specification.md");
      const cubeState = resources.resources.find(
        (resource) =>
          (resource._meta as Record<string, unknown> | undefined)?.["browsermcp/sourceUri"] ===
          "browsermcp://benchmark/rubiks-cube/state",
      );
      if (cubeState === undefined)
        throw new Error("The site did not publish the cube state Resource");
      const cubeResource = await client.readResource({ uri: cubeState.uri });
      expect(JSON.stringify(cubeResource.contents)).toContain(
        String((cubeResult.structuredContent as { state?: { stateId?: string } }).state?.stateId),
      );

      const prompts = await client.listPrompts();
      expect(prompts.prompts).toHaveLength(4);
      const setupPrompt = prompts.prompts.find(({ name }) =>
        name.endsWith("__browsermcp_get_started"),
      );
      if (setupPrompt === undefined) throw new Error("The site did not publish its setup prompt");
      const promptResult = await client.getPrompt({
        name: setupPrompt.name,
        arguments: { environment: "GitHub Pages HTTPS with a local WSS Bridge" },
      });
      expect(JSON.stringify(promptResult.messages)).toContain("docs_implementation_guide");
      expect(JSON.stringify(promptResult.messages)).toContain("GitHub Pages HTTPS");
    } finally {
      await client.close().catch(() => undefined);
      await app.disconnect({ reason: "Integration test complete" }).catch(() => undefined);
      await registration?.unregister().catch(() => undefined);
      await bridge.close();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
