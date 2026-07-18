import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  configFromEnvironment,
  DEFAULT_LIMITS,
  LOOPBACK_HOST,
  normalizeBridgeConfig,
} from "../../src/config.js";

describe("bridge configuration", () => {
  it("is always bound to IPv4 loopback and accepts explicit TLS files", () => {
    const certPath = join(tmpdir(), "cert.pem");
    const keyPath = join(tmpdir(), "key.pem");
    const config = configFromEnvironment({
      BROWSERMCP_PORT: "9443",
      BROWSERMCP_ALLOWED_ORIGINS: "https://one.test, https://two.test",
      BROWSERMCP_TLS_CERT: certPath,
      BROWSERMCP_TLS_KEY: keyPath,
    });
    expect(config.host).toBe(LOOPBACK_HOST);
    expect(config.port).toBe(9443);
    expect(config.allowedOrigins).toEqual(["https://one.test", "https://two.test"]);
    expect(config.tls).toEqual({ certPath, keyPath });
  });

  it("rejects incomplete TLS configuration and invalid limits", () => {
    expect(() =>
      configFromEnvironment({ BROWSERMCP_TLS_CERT: join(tmpdir(), "cert.pem") }),
    ).toThrow(/must be set together/);
    expect(() => configFromEnvironment({ BROWSERMCP_PORT: "0" })).toThrow(
      /positive base-10 integer/u,
    );
    for (const nonDecimal of ["1e3", "0x10", " 8789 "]) {
      expect(() => configFromEnvironment({ BROWSERMCP_PORT: nonDecimal })).toThrow(
        /positive base-10 integer/u,
      );
    }
    expect(() =>
      configFromEnvironment({
        BROWSERMCP_HTTP_HEADERS_TIMEOUT_MS: "200",
        BROWSERMCP_HTTP_REQUEST_TIMEOUT_MS: "100",
      }),
    ).toThrow(/must not exceed/);
  });

  it("has room for the Docs capability set and reads resource-bound env limits", () => {
    expect(DEFAULT_LIMITS.maxRegistrationsPerRuntime).toBeGreaterThanOrEqual(46);
    const config = configFromEnvironment({
      BROWSERMCP_MAX_REGISTRATIONS_PER_RUNTIME: "50",
      BROWSERMCP_MAX_REGISTRATIONS_TOTAL: "100",
      BROWSERMCP_MAX_REGISTRATION_BYTES_PER_RUNTIME: "4096",
      BROWSERMCP_MAX_REGISTRATION_BYTES_TOTAL: "8192",
      BROWSERMCP_MAX_MCP_SESSIONS: "4",
      BROWSERMCP_MCP_SESSION_IDLE_TTL_MS: "5000",
    });
    expect(config.limits).toMatchObject({
      maxRegistrationsPerRuntime: 50,
      maxRegistrationsTotal: 100,
      maxRegistrationBytesPerRuntime: 4096,
      maxRegistrationBytesTotal: 8192,
      maxMcpSessions: 4,
      mcpSessionIdleTtlMs: 5000,
    });
  });

  it("enforces runtime loopback and protocol-compatible limits for JavaScript callers", () => {
    expect(() =>
      normalizeBridgeConfig({
        host: "0.0.0.0" as typeof LOOPBACK_HOST,
        port: 8789,
        allowedOrigins: [],
        limits: DEFAULT_LIMITS,
      }),
    ).toThrow(/host must be exactly 127\.0\.0\.1/u);
    expect(() =>
      normalizeBridgeConfig({
        host: LOOPBACK_HOST,
        port: 8789,
        allowedOrigins: [],
        limits: { ...DEFAULT_LIMITS, maxWebSocketPayloadBytes: 1_023 },
      }),
    ).toThrow(/at least 1024 bytes/u);
    expect(() =>
      normalizeBridgeConfig({
        host: LOOPBACK_HOST,
        port: 8789,
        allowedOrigins: [],
        limits: { ...DEFAULT_LIMITS, maxWebSocketPayloadBytes: 1_048_577 },
      }),
    ).toThrow(/must not exceed 1048576 bytes/u);
    expect(() =>
      normalizeBridgeConfig({
        host: LOOPBACK_HOST,
        port: 8789,
        allowedOrigins: [],
        limits: { ...DEFAULT_LIMITS, browserRequestTimeoutMs: 600_001 },
      }),
    ).toThrow(/must not exceed 600000 ms/u);
    expect(() =>
      normalizeBridgeConfig({
        host: LOOPBACK_HOST,
        port: 8789,
        allowedOrigins: [],
        limits: {
          ...DEFAULT_LIMITS,
          maxConcurrentRequests: 20_000,
          maxConcurrentRequestsPerRuntime: 10_001,
        },
      }),
    ).toThrow(/must not exceed 10000/u);
  });

  it("clones and freezes security-sensitive caller-owned configuration", () => {
    const allowedOrigins = ["https://example.test"];
    const limits = { ...DEFAULT_LIMITS };
    const config = normalizeBridgeConfig({
      host: LOOPBACK_HOST,
      port: 8789,
      allowedOrigins,
      limits,
    });
    allowedOrigins.push("https://attacker.test");
    limits.maxHttpConnections = 9_999;
    expect(config.allowedOrigins).toEqual(["https://example.test"]);
    expect(config.limits.maxHttpConnections).toBe(DEFAULT_LIMITS.maxHttpConnections);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedOrigins)).toBe(true);
    expect(Object.isFrozen(config.limits)).toBe(true);
  });
});
