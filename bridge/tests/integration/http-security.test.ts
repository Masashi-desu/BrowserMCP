import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { BrowserMcpBridge } from "../../src/bridge.js";
import { ADMIN_TOKEN, BrowserPeer, MCP_TOKEN, testConfig } from "./helpers.js";

describe("loopback HTTP security and state API", () => {
  let bridge: BrowserMcpBridge | undefined;
  const peers: BrowserPeer[] = [];

  afterEach(async () => {
    await Promise.allSettled(peers.splice(0).map((peer) => peer.close()));
    await bridge?.close();
    bridge = undefined;
  });

  it("enforces Host, strict health CORS/PNA, MCP bearer auth, and admin auth", async () => {
    const webOrigin = "https://site.example.test";
    bridge = new BrowserMcpBridge(testConfig({ allowedOrigins: [webOrigin] }));
    const address = await bridge.start();
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const cors = await fetch(`${base}/health`, { headers: { Origin: webOrigin } });
    expect(cors.headers.get("access-control-allow-origin")).toBe(webOrigin);
    expect(cors.headers.get("access-control-allow-private-network")).toBe("true");

    const unpairedSecureOrigin = await fetch(`${base}/health`, {
      headers: { Origin: "https://attacker.test" },
    });
    expect(unpairedSecureOrigin.status).toBe(200);
    expect(unpairedSecureOrigin.headers.get("access-control-allow-origin")).toBe(
      "https://attacker.test",
    );

    const deniedCors = await fetch(`${base}/health`, {
      headers: { Origin: "http://attacker.test" },
    });
    expect(deniedCors.status).toBe(403);

    const preflight = await fetch(`${base}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: webOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

    const noMcpAuth = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    expect(noMcpAuth.status).toBe(401);
    const badMcpAuth = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer bmp_mcp_${"x".repeat(43)}` },
      body: "{}",
    });
    expect(badMcpAuth.status).toBe(401);

    const browserMcp = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${MCP_TOKEN}`, Origin: webOrigin },
      body: "{}",
    });
    expect(browserMcp.status).toBe(403);

    const unknownMcpSession = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${MCP_TOKEN}`,
        "content-type": "application/json",
        "mcp-session-id": "unknown-session",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(unknownMcpSession.status).toBe(404);

    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    const stateResponse = await fetch(`${base}/api/state`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(stateResponse.status).toBe(200);
    const serializedState = JSON.stringify(await stateResponse.json());
    expect(serializedState).not.toContain(MCP_TOKEN);
    expect(serializedState).not.toContain(ADMIN_TOKEN);

    const invalidHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/health",
          headers: { Host: "attacker.example" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(invalidHostStatus).toBe(421);
  });

  it("requires same-origin and a session-bound CSRF token for approval and legacy token mutations", async () => {
    bridge = new BrowserMcpBridge(testConfig());
    const address = await bridge.start();
    const base = `http://127.0.0.1:${address.port}`;
    const peer = new BrowserPeer(address.browserEndpoint, "https://docs.example.test");
    peers.push(peer);
    const approval = await peer.requestApproval();

    const login = await fetch(`${base}/api/ui-session`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, Origin: base },
    });
    expect(login.status).toBe(204);
    const cookie = login.headers.getSetCookie()[0]?.split(";", 1)[0];
    expect(cookie).toMatch(/^browsermcp_ui=/);

    const page = await fetch(`${base}/`, { headers: { Cookie: cookie ?? "" } });
    const html = await page.text();
    const csrf = /const csrf="([A-Za-z0-9_-]+)"/.exec(html)?.[1];
    expect(csrf).toBeTruthy();

    const missingApprovalCsrf = await fetch(
      `${base}/api/pairing-requests/${approval.payload.requestId}`,
      {
        method: "POST",
        headers: { Cookie: cookie ?? "", "content-type": "application/json", Origin: base },
        body: JSON.stringify({ decision: "approve" }),
      },
    );
    expect(missingApprovalCsrf.status).toBe(403);

    const crossOriginApproval = await fetch(
      `${base}/api/pairing-requests/${approval.payload.requestId}`,
      {
        method: "POST",
        headers: {
          Cookie: cookie ?? "",
          "content-type": "application/json",
          "x-browsermcp-csrf": csrf ?? "",
          Origin: "https://attacker.test",
        },
        body: JSON.stringify({ decision: "approve" }),
      },
    );
    expect(crossOriginApproval.status).toBe(403);

    const approved = await fetch(`${base}/api/pairing-requests/${approval.payload.requestId}`, {
      method: "POST",
      headers: {
        Cookie: cookie ?? "",
        "content-type": "application/json",
        "x-browsermcp-csrf": csrf ?? "",
        Origin: base,
      },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(approved.status).toBe(204);
    await expect(peer.waitFor("welcome")).resolves.toMatchObject({ type: "welcome" });

    const missingCsrf = await fetch(`${base}/api/pairing-tokens`, {
      method: "POST",
      headers: { Cookie: cookie ?? "", "content-type": "application/json", Origin: base },
      body: JSON.stringify({ origin: "https://docs.example.test" }),
    });
    expect(missingCsrf.status).toBe(403);

    const crossOrigin = await fetch(`${base}/api/pairing-tokens`, {
      method: "POST",
      headers: {
        Cookie: cookie ?? "",
        "content-type": "application/json",
        "x-browsermcp-csrf": csrf ?? "",
        Origin: "https://attacker.test",
      },
      body: JSON.stringify({ origin: "https://docs.example.test" }),
    });
    expect(crossOrigin.status).toBe(403);

    const paired = await fetch(`${base}/api/pairing-tokens`, {
      method: "POST",
      headers: {
        Cookie: cookie ?? "",
        "content-type": "application/json",
        "x-browsermcp-csrf": csrf ?? "",
        Origin: base,
      },
      body: JSON.stringify({ origin: "https://docs.example.test" }),
    });
    expect(paired.status).toBe(201);
    expect((await paired.json()).token).toMatch(/^bmp_pair_/);

    const insecurePublicOrigin = await fetch(`${base}/api/pairing-tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ origin: "http://public.example.test" }),
    });
    expect(insecurePublicOrigin.status).toBe(400);

    const localDevelopmentOrigin = await fetch(`${base}/api/pairing-tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ origin: "http://localhost:4173" }),
    });
    expect(localDevelopmentOrigin.status).toBe(201);
  });

  it("rejects HTTP bodies over the configured limit before processing", async () => {
    bridge = new BrowserMcpBridge(
      testConfig({ limits: { ...testConfig().limits, maxHttpBodyBytes: 64 } }),
    );
    const address = await bridge.start();
    const response = await fetch(`${address.statusEndpoint}api/pairing-tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ origin: `https://${"x".repeat(100)}.test` }),
    });
    expect(response.status).toBe(413);
  });
});
