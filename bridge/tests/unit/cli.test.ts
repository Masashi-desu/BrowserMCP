import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import { formatReadyOutput, main, parseCli, shutdownSignalsForPlatform } from "../../src/cli.js";

describe("bridge CLI", () => {
  it("parses repeatable origins and paired TLS files", () => {
    const certPath = join(tmpdir(), "cert.pem");
    const keyPath = join(tmpdir(), "key.pem");
    expect(
      parseCli([
        "--port",
        "9443",
        "--allow-origin",
        "https://one.test",
        "--allow-origin",
        "https://two.test",
        "--pair-origin",
        "https://one.test",
        "--tls-cert",
        certPath,
        "--tls-key",
        keyPath,
        "--json",
      ]),
    ).toEqual({
      allowedOrigins: ["https://one.test", "https://two.test"],
      json: true,
      pairingOrigins: ["https://one.test"],
      port: 9443,
      tlsCert: certPath,
      tlsKey: keyPath,
    });
  });

  it("rejects unknown, invalid, and partial TLS options", () => {
    expect(() => parseCli(["--unknown"])).toThrow(/Unknown option/);
    expect(() => parseCli(["--port", "0"])).toThrow(/1 to 65535/);
    expect(() => parseCli(["--tls-cert", join(tmpdir(), "cert.pem")])).toThrow(/provided together/);
  });

  it("preserves Windows PEM paths, including spaces, as opaque CLI values", () => {
    const certPath = win32.join("C:\\", "Program Files", "BrowserMCP", "localhost cert.pem");
    const keyPath = win32.join("C:\\", "Program Files", "BrowserMCP", "localhost key.pem");
    expect(parseCli(["--tls-cert", certPath, "--tls-key", keyPath])).toMatchObject({
      tlsCert: certPath,
      tlsKey: keyPath,
    });
  });

  it("emits one machine-readable ready event for native shells", () => {
    const output = formatReadyOutput(
      {
        adminToken: "admin-token",
        browserEndpoint: "ws://127.0.0.1:8789/browser",
        host: "127.0.0.1",
        mcpEndpoint: "http://127.0.0.1:8789/mcp",
        mcpToken: "mcp-token",
        port: 8789,
        statusEndpoint: "http://127.0.0.1:8789/",
      },
      [{ expiresAt: 1_800_000_000_000, origin: "https://app.test", token: "pair-token" }],
      true,
    );
    expect(output.split("\n")).toHaveLength(2);
    expect(JSON.parse(output)).toEqual({
      type: "ready",
      mcpEndpoint: "http://127.0.0.1:8789/mcp",
      mcpToken: "mcp-token",
      browserEndpoint: "ws://127.0.0.1:8789/browser",
      statusEndpoint: "http://127.0.0.1:8789/",
      adminToken: "admin-token",
      pairingTokens: [
        { expiresAt: 1_800_000_000_000, origin: "https://app.test", token: "pair-token" },
      ],
    });
  });

  it("keeps the existing human-readable startup format by default", () => {
    const output = formatReadyOutput(
      {
        adminToken: "admin-token",
        browserEndpoint: "ws://127.0.0.1:8789/browser",
        host: "127.0.0.1",
        mcpEndpoint: "http://127.0.0.1:8789/mcp",
        mcpToken: "mcp-token",
        port: 8789,
        statusEndpoint: "http://127.0.0.1:8789/",
      },
      [{ expiresAt: 1_800_000_000_000, origin: "https://app.test", token: "pair-token" }],
      false,
    );
    expect(output).toContain("BrowserMCP Bridge is ready.\nMCP endpoint:");
    expect(output).toContain("Pairing token for https://app.test (shown once");
  });

  it("uses graceful shutdown signals available to each Node platform", () => {
    expect(shutdownSignalsForPlatform("darwin")).toEqual(["SIGINT", "SIGTERM"]);
    expect(shutdownSignalsForPlatform("linux")).toEqual(["SIGINT", "SIGTERM"]);
    expect(shutdownSignalsForPlatform("win32")).toEqual(["SIGINT", "SIGTERM", "SIGBREAK"]);
  });

  it("rejects an unsafe pairing Origin before starting the listener", async () => {
    await expect(main(["--pair-origin", "http://remote.example.test"])).rejects.toThrow(
      /Origin must be an absolute HTTPS origin/u,
    );
  });
});
