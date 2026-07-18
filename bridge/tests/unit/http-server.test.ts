import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { configureHttpServer } from "../../src/bridge.js";
import { DEFAULT_LIMITS } from "../../src/config.js";

describe("HTTP server bounds", () => {
  it("bounds connections and slow request intake while leaving active SSE responses alone", () => {
    const limits = {
      ...DEFAULT_LIMITS,
      httpHeadersTimeoutMs: 1_234,
      httpKeepAliveTimeoutMs: 2_345,
      httpRequestTimeoutMs: 3_456,
      maxHttpConnections: 17,
    };
    const server = createServer();
    configureHttpServer(server, limits);
    expect(server.maxConnections).toBe(17);
    expect(server.headersTimeout).toBe(1_234);
    expect(server.keepAliveTimeout).toBe(2_345);
    expect(server.requestTimeout).toBe(3_456);
    expect(server.maxHeadersCount).toBe(100);
    expect(server.maxRequestsPerSocket).toBe(1_000);
    expect(
      (server as typeof server & { connectionsCheckingInterval: number })
        .connectionsCheckingInterval,
    ).toBe(1_000);
    expect(server.timeout).toBe(0);
  });
});
