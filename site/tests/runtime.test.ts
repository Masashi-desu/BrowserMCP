import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserMcpSiteController,
  safeRuntimeSnapshot,
  summarizeLatestExecution,
} from "../src/browsermcp/controller.js";
import { resultMetadata } from "../src/browsermcp/registration.js";
import {
  connectionDiagnostics,
  DEVELOPMENT_BRIDGE_URL,
  defaultBridgeUrl,
  SECURE_BRIDGE_URL,
  validateBridgeUrl,
} from "../src/runtime/bridge-config.js";
import { resolveViteBase } from "../src/runtime/deployment.js";
import { validateStorageEntry } from "../src/runtime/storage.js";
import { analyzeInWorker } from "../src/runtime/worker-client.js";
import { analyzeText } from "../src/runtime/worker-logic.js";
import {
  createConnectionDraft,
  latestConnectionLogs,
  reconcileConnectionDraft,
} from "../src/ui/connection.js";
import { parseRoute, routeSnapshot } from "../src/ui/router.js";

afterEach(() => vi.unstubAllGlobals());

describe("safe browser runtime helpers", () => {
  it("selects WSS for secure static pages and WS only for local HTTP development", () => {
    expect(defaultBridgeUrl(new URL("https://example.github.io/BrowserMCP/"))).toBe(
      SECURE_BRIDGE_URL,
    );
    expect(defaultBridgeUrl(new URL("http://127.0.0.1:4173/"))).toBe(DEVELOPMENT_BRIDGE_URL);
    expect(() => defaultBridgeUrl(new URL("http://public.example/"))).toThrow(/HTTPS/u);
    expect(SECURE_BRIDGE_URL).toBe("wss://127.0.0.1:8789/browser");
  });

  it("rejects non-loopback and credential-bearing Bridge URLs", () => {
    expect(() => validateBridgeUrl("wss://bridge.example.com/browser")).toThrow(/loopback/u);
    expect(() => validateBridgeUrl("wss://user:pass@127.0.0.1:8789/browser")).toThrow(
      /Credentials/u,
    );
    expect(() => validateBridgeUrl("wss://127.0.0.1:8789/wrong")).toThrow(/\/browser/u);
    expect(() => validateBridgeUrl("wss://127.0.0.1:8789/browser?token=nope")).toThrow(/query/u);
    expect(() => validateBridgeUrl("wss://[::1]:8789/browser")).toThrow(/IPv4-only/u);
    expect(() =>
      validateBridgeUrl(DEVELOPMENT_BRIDGE_URL, new URL("https://example.github.io/")),
    ).toThrow(/HTTPS/u);
    expect(validateBridgeUrl(SECURE_BRIDGE_URL).hostname).toBe("127.0.0.1");
    expect(() => validateBridgeUrl(SECURE_BRIDGE_URL, new URL("http://public.example/"))).toThrow(
      /HTTPS/u,
    );
    expect(
      validateBridgeUrl(DEVELOPMENT_BRIDGE_URL, new URL("http://localhost:4173/")).toString(),
    ).toBe(DEVELOPMENT_BRIDGE_URL);
  });

  it("diagnoses mixed content, certificate trust, exact Origin, and LNA", () => {
    const blocked = connectionDiagnostics(
      DEVELOPMENT_BRIDGE_URL,
      new URL("https://example.github.io/repo/"),
    );
    expect(blocked.find(({ id }) => id === "transport")?.level).toBe("blocked");
    const secure = connectionDiagnostics(
      SECURE_BRIDGE_URL,
      new URL("https://example.github.io/repo/"),
    );
    expect(secure.map(({ id }) => id)).toEqual([
      "transport",
      "certificate",
      "origin",
      "local-network",
    ]);
    expect(secure.find(({ id }) => id === "origin")?.detail).toContain("https://example.github.io");
  });

  it("does not retain an invalid credential-bearing health-check URL", async () => {
    vi.stubGlobal("location", new URL("https://example.github.io/BrowserMCP/#/connection"));
    const controller = new BrowserMcpSiteController(SECURE_BRIDGE_URL, () => ({
      title: "Connection status",
      path: "/connection",
      route: "connection",
      hash: "",
      locale: "en",
      direction: "ltr",
    }));

    await expect(
      controller.checkHealth(`${SECURE_BRIDGE_URL}?access_token=must-not-be-retained`),
    ).rejects.toThrow(/query/u);
    expect(controller.getViewModel().bridgeUrl).toBe(SECURE_BRIDGE_URL);
    expect(JSON.stringify(controller.getViewModel())).not.toContain("must-not-be-retained");
    await controller.destroy();
  });

  it("normalizes Vite base paths for relative and GitHub Pages subpath builds", () => {
    expect(resolveViteBase()).toBe("./");
    expect(resolveViteBase("BrowserMCP")).toBe("/BrowserMCP/");
    expect(resolveViteBase("/BrowserMCP/")).toBe("/BrowserMCP/");
  });

  it("bounds IndexedDB entries and rejects secret-like keys", () => {
    expect(validateStorageEntry("example.note", { safe: true })).toContain("safe");
    expect(() => validateStorageEntry("pairing-token", "nope")).toThrow(/Secret-like/u);
    expect(() => validateStorageEntry("example", { nested: { authorization: "hidden" } })).toThrow(
      /nested/u,
    );
    for (const key of [
      "apiKey",
      "api_key",
      "api-key",
      "accessToken",
      "refreshToken",
      "idToken",
      "clientSecret",
      "privateKey",
    ]) {
      expect(() => validateStorageEntry("example", { [key]: "hidden" })).toThrow(/Secret-like/u);
    }
    expect(() => validateStorageEntry("example", "request apiKey=hidden")).toThrow(
      /Secret-like strings/u,
    );
    expect(() =>
      validateStorageEntry("example", JSON.parse('{"nested":{"__proto__":{"polluted":true}}}')),
    ).toThrow(/Prototype-mutating/u);
    expect(() => validateStorageEntry("example", { nested: "Bearer abc123" })).toThrow(
      /Secret-like strings/u,
    );
    expect(() => validateStorageEntry("example", { nested: "bmp_pair_abc123" })).toThrow(
      /Secret-like strings/u,
    );
    expect(() => validateStorageEntry("example", Number.NaN)).toThrow(/finite/u);
    expect(() => validateStorageEntry("example", new Date())).toThrow(/plain JSON/u);
    expect(() => validateStorageEntry("x", "a".repeat(33_000))).toThrow(/exceeds/u);
  });

  it("provides deterministic pure text analysis used by the Web Worker", () => {
    expect(analyzeText("Bridge browser bridge\nMCP")).toEqual({
      characters: 25,
      words: 4,
      lines: 2,
      uniqueWords: 3,
      topTerms: [
        { term: "bridge", count: 2 },
        { term: "browser", count: 1 },
        { term: "mcp", count: 1 },
      ],
    });
  });

  it("uses the newest first execution record for the connection UI result", () => {
    expect(
      summarizeLatestExecution([
        {
          invocationId: "new",
          registrationId: "tool:new",
          kind: "tool",
          name: "docs_search",
          status: "success",
          startedAt: 2,
          finishedAt: 3,
          durationMs: 1,
        },
        {
          invocationId: "old",
          registrationId: "tool:old",
          kind: "tool",
          name: "old_tool",
          status: "error",
          startedAt: 1,
          error: { code: "OLD", message: "old failure" },
        },
      ]),
    ).toBe("tool docs_search completed in 1 ms.");
  });

  it("omits query strings and fragments from the runtime capability", () => {
    const snapshot = safeRuntimeSnapshot(
      new URL("https://example.github.io/BrowserMCP/?access_token=secret#/docs"),
      {
        language: "en",
        online: true,
        userAgent: "test",
        secureContext: true,
        worker: true,
        indexedDb: true,
        webAssembly: true,
      },
    );
    expect(snapshot).toMatchObject({
      origin: "https://example.github.io",
      pathname: "/BrowserMCP/",
    });
    expect(JSON.stringify(snapshot)).not.toContain("access_token");
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });

  it("only publishes known documentation sections and a fixed not-found path", () => {
    const known = parseRoute("#/docs/tools#register-tool");
    expect(known).toMatchObject({ kind: "docs-page", sectionId: "register-tool" });

    for (const unsafe of [
      "#/docs/tools#access_token=credential-value",
      `#/docs/tools#${"x".repeat(20_000)}`,
    ]) {
      const route = parseRoute(unsafe);
      expect(route).toMatchObject({ kind: "docs-page" });
      expect(route).not.toHaveProperty("sectionId");
      expect(JSON.stringify(routeSnapshot(route))).not.toContain("credential-value");
    }

    const missing = parseRoute("#/access_token=credential-value");
    expect(missing).toEqual({ kind: "not-found", path: "/not-found" });
    expect(routeSnapshot(missing).path).toBe("/not-found");
  });

  it("keeps connection form input across snapshot-driven rerenders and logs newest first", () => {
    const draft = createConnectionDraft("wss://127.0.0.1:8789/browser");
    draft.bridgeUrl = "wss://localhost:8789/browser";
    draft.bridgeDirty = true;
    reconcileConnectionDraft(draft, "wss://127.0.0.1:9999/browser");
    expect(draft).toMatchObject({
      bridgeUrl: "wss://localhost:8789/browser",
    });
    expect(
      latestConnectionLogs([
        { timestamp: 3, level: "info", event: "newest" },
        { timestamp: 2, level: "info", event: "middle" },
        { timestamp: 1, level: "info", event: "oldest" },
      ]).map(({ event }) => event),
    ).toEqual(["newest", "middle", "oldest"]);
  });

  it("summarizes handler outputs with structural metadata only", () => {
    const secret = "arbitrary-user-secret-that-must-not-enter-logs";
    const metadata = resultMetadata({
      content: [{ type: "text", text: secret }],
      structuredContent: { value: secret },
    });
    expect(metadata).toMatchObject({
      contentItems: 1,
      structuredContentPresent: true,
      sizeBucket: expect.any(String),
    });
    expect(JSON.stringify(metadata)).not.toContain(secret);
  });

  it("rejects an already-aborted Worker request before constructing a Worker", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(analyzeInWorker("never starts", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
