import { describe, expect, it } from "vitest";

import { RingLogger, redact, safeText } from "../../src/logger.js";

describe("redacted logging", () => {
  it("removes tokens, authorization, cookies, and token query parameters recursively", () => {
    const redacted = redact({
      authorization: `Bearer bmp_mcp_${"a".repeat(43)}`,
      nested: {
        url: `ws://127.0.0.1/browser?token=bmp_pair_${"b".repeat(43)}`,
        safe: "visible",
      },
      cookie: "browsermcp_ui=secret",
    });
    expect(JSON.stringify(redacted)).not.toContain("bmp_mcp_");
    expect(JSON.stringify(redacted)).not.toContain("bmp_pair_");
    expect(JSON.stringify(redacted)).not.toContain("browsermcp_ui");
    expect(redacted).toMatchObject({ nested: { safe: "visible" } });
  });

  it("normalizes known credential field names without pretending to detect arbitrary secrets", () => {
    const redacted = redact({
      apiKey: "camel-api-secret",
      api_key: "snake-api-secret",
      "api-key": "kebab-api-secret",
      accessToken: "access-secret",
      refresh_token: "refresh-secret",
      idToken: "id-secret",
      clientSecret: "client-secret",
      privateKey: "private-key-secret",
      diagnosticValue: "ordinary-opaque-value",
    });
    const serialized = JSON.stringify(redacted);
    for (const secret of [
      "camel-api-secret",
      "snake-api-secret",
      "kebab-api-secret",
      "access-secret",
      "refresh-secret",
      "id-secret",
      "client-secret",
      "private-key-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(redacted).toMatchObject({ diagnosticValue: "ordinary-opaque-value" });
  });

  it("keeps only the configured number of recent entries", () => {
    const logger = new RingLogger(2);
    logger.info("one");
    logger.warn("two");
    logger.error("three");
    expect(logger.recent().map(({ message }) => message)).toEqual(["three", "two"]);
  });

  it("bounds and redacts untrusted error text", () => {
    const value = `failed bmp_pair_${"s".repeat(43)} Bearer eyJhbGciOiJIUzI1Ni.payload.signature ${"x".repeat(2_000)}`;
    const safe = safeText(value, 128);
    expect(safe).not.toContain("bmp_pair_");
    expect(safe).not.toContain("eyJhbGci");
    expect(safe).toContain("Bearer [REDACTED]");
    expect(safe.length).toBeLessThanOrEqual(129);
    expect(safe.endsWith("…")).toBe(true);
  });

  it("keeps logging best-effort when an injected sink throws", () => {
    const logger = new RingLogger(2, () => {
      throw new Error("sink unavailable");
    });
    expect(() => logger.info("still recorded")).not.toThrow();
    expect(logger.recent()).toMatchObject([{ message: "still recorded" }]);
  });

  it("isolates immutable stored entries from sink and caller mutation", () => {
    let callbackEntry: ReturnType<RingLogger["recent"]>[number] | undefined;
    const logger = new RingLogger(2, (entry) => {
      callbackEntry = entry;
    });
    logger.info("safe", { nested: { value: "original" } });
    expect(Object.isFrozen(callbackEntry)).toBe(true);
    expect(Object.isFrozen(callbackEntry?.context)).toBe(true);

    const publicEntry = logger.recent()[0];
    expect(Object.isFrozen(publicEntry)).toBe(true);
    expect(Object.isFrozen(publicEntry?.context)).toBe(true);
    expect(() => {
      (publicEntry as { message: string }).message = "mutated";
    }).toThrow();
    expect(logger.recent()[0]?.message).toBe("safe");
  });

  it("keeps bigint diagnostic values JSON-safe", () => {
    const logger = new RingLogger();
    logger.info("number", { large: 1n });
    expect(() => JSON.stringify(logger.recent())).not.toThrow();
    expect(logger.recent()[0]?.context).toEqual({ large: "1n" });
  });

  it("redacts and bounds the log message itself and credential-like query values", () => {
    const secret = "very-sensitive-value";
    const logger = new RingLogger();
    logger.warn(
      `Request failed: https://alice:user-password@example.test/callback?id_token=${secret}&api%5Fkey=${secret}&safe=ok /cb?code=${secret} ${"x".repeat(3_000)}`,
    );
    const message = logger.recent()[0]?.message ?? "";
    expect(message).not.toContain(secret);
    expect(message).not.toContain("alice");
    expect(message).not.toContain("user-password");
    expect(message).toContain("safe=ok");
    expect(message.length).toBeLessThanOrEqual(2_049);
    expect(safeText("https://runtime.example.test")).toBe("https://runtime.example.test");
  });

  it("redacts recognized credential assignments in message text", () => {
    const message = safeText(
      "apiKey=message-secret client_secret='quoted secret' private-key=private-secret diagnostic=visible",
    );
    expect(message).not.toContain("message-secret");
    expect(message).not.toContain("quoted secret");
    expect(message).not.toContain("private-secret");
    expect(message).toContain("diagnostic=visible");
  });
});
