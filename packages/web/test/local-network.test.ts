import { describe, expect, it, vi } from "vitest";

import {
  BrowserMCPError,
  DEFAULT_BRIDGE_URL,
  deriveHealthUrl,
  prepareLocalNetworkAccess,
  validateBridgeUrl,
} from "../src/index.js";

describe("loopback URL security", () => {
  it("uses the IPv4 loopback WSS endpoint by default", () => {
    expect(DEFAULT_BRIDGE_URL).toBe("wss://127.0.0.1:8789/browser");
    expect(deriveHealthUrl(DEFAULT_BRIDGE_URL)).toBe("https://127.0.0.1:8789/health");
  });

  it("rejects insecure WebSockets before connection from an HTTPS page", () => {
    expect(() =>
      validateBridgeUrl("ws://127.0.0.1:8789/browser", "https://public.example"),
    ).toThrowError(
      expect.objectContaining({
        code: "INSECURE_BRIDGE_URL",
        message: expect.stringContaining("trusted wss:"),
      }),
    );
    expect(
      validateBridgeUrl("ws://127.0.0.1:8789/browser", "http://localhost:5173").toString(),
    ).toBe("ws://127.0.0.1:8789/browser");
    expect(
      validateBridgeUrl("wss://127.0.0.1:8789/browser", "https://public.example").toString(),
    ).toBe("wss://127.0.0.1:8789/browser");
  });

  it("requires HTTPS for every non-loopback page Origin", () => {
    for (const bridgeUrl of ["ws://127.0.0.1:8789/browser", "wss://127.0.0.1:8789/browser"]) {
      expect(() => validateBridgeUrl(bridgeUrl, "http://public.example")).toThrowError(
        expect.objectContaining({ code: "INSECURE_BRIDGE_URL" }),
      );
    }
  });

  it("rejects non-loopback targets and any URL-carried credentials", () => {
    for (const url of [
      "wss://bridge.example/browser",
      "wss://user:password@127.0.0.1:8789/browser",
      "wss://127.0.0.1:8789/browser?token=secret",
      "wss://127.0.0.1:8789/other",
      "wss://[::1]:8789/browser",
    ]) {
      expect(() => validateBridgeUrl(url, "https://public.example")).toThrowError(BrowserMCPError);
    }
  });
});

describe("Local Network Access preparation", () => {
  it("performs a credential-free loopback health request with the LNA hint", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response('{"status":"ok"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await prepareLocalNetworkAccess(DEFAULT_BRIDGE_URL, {
      fetcher,
      pageOrigin: "https://public.example",
    });

    expect(result).toEqual({ url: "https://127.0.0.1:8789/health", status: 200 });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url?.toString()).toBe("https://127.0.0.1:8789/health");
    expect(request).toMatchObject({
      method: "GET",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      targetAddressSpace: "loopback",
    });
    expect(JSON.stringify(request)).not.toContain("token");
  });

  it("provides an actionable error when permission, trust, or reachability fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(
      prepareLocalNetworkAccess(DEFAULT_BRIDGE_URL, { fetcher, timeoutMs: 100 }),
    ).rejects.toMatchObject({
      code: "LOCAL_NETWORK_ACCESS_FAILED",
      retryable: true,
      message: expect.stringContaining("trust the Bridge loopback certificate"),
    });
  });

  it("rejects a non-loopback health override", async () => {
    await expect(
      prepareLocalNetworkAccess(DEFAULT_BRIDGE_URL, {
        healthUrl: "https://example.test/health",
        fetcher: vi.fn<typeof fetch>(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_BRIDGE_URL" });
  });
});
