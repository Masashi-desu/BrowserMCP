import { describe, expect, it } from "vitest";

import { AllowedOrigins } from "../../src/origins.js";
import {
  AdminAuthenticator,
  normalizeWebOrigin,
  OneTimeTokenStore,
  SecretVerifier,
} from "../../src/security.js";

describe("security tokens", () => {
  it("uses one-time, expiring tokens without retaining plaintext", () => {
    let now = 1_000;
    const store = new OneTimeTokenStore<{ origin: string }>("pair", 100, () => now);
    const first = store.issue({ origin: "https://example.test" });

    expect(first.token).toMatch(/^bmp_pair_[A-Za-z0-9_-]{43}$/);
    expect(store.consume(first.token)).toEqual({ origin: "https://example.test" });
    expect(store.consume(first.token)).toBeUndefined();

    const expired = store.issue({ origin: "https://expired.test" });
    now += 101;
    expect(store.consume(expired.token)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("compares high-entropy bearer secrets and rejects malformed values", () => {
    const verifier = new SecretVerifier(`bmp_mcp_${"a".repeat(43)}`);
    expect(verifier.verify(`bmp_mcp_${"a".repeat(43)}`)).toBe(true);
    expect(verifier.verify(`bmp_mcp_${"b".repeat(43)}`)).toBe(false);
    expect(verifier.verify(undefined)).toBe(false);
  });

  it("binds CSRF tokens to an authenticated UI session", () => {
    const auth = new AdminAuthenticator(`bmp_admin_${"a".repeat(43)}`, 1_000);
    const session = auth.createSession();
    expect(auth.verifySession(session.token)).toBe(true);
    expect(auth.csrfToken(session.token)).toBe(session.csrfToken);
    expect(auth.verifyCsrf(session.token, session.csrfToken)).toBe(true);
    expect(auth.verifyCsrf(session.token, "wrong")).toBe(false);
  });
});

describe("strict origins", () => {
  it.each([
    ["https://example.test", "https://example.test"],
    ["https://example.test:8443", "https://example.test:8443"],
    ["http://127.0.0.1:4173", "http://127.0.0.1:4173"],
    ["http://localhost:4173", "http://localhost:4173"],
  ])("accepts an exact http(s) origin: %s", (input, expected) => {
    expect(normalizeWebOrigin(input)).toBe(expected);
  });

  it.each([
    "null",
    "file:///tmp/app.html",
    "https://example.test/path",
    "https://user@example.test",
    "https://example.test?token=x",
    "http://public.example.test",
    "http://192.168.1.10:4173",
    "javascript:alert(1)",
  ])("rejects a non-origin value: %s", (input) => {
    expect(normalizeWebOrigin(input)).toBeUndefined();
  });

  it("applies the secure-origin policy to configured and issued authorities", () => {
    expect(() => new AllowedOrigins(["http://public.example.test"])).toThrow(/HTTPS origin/u);
    const origins = new AllowedOrigins([
      "http://127.0.0.1:4173",
      "http://localhost:4173",
      "https://public.example.test",
    ]);
    expect(origins.values()).toEqual([
      "http://127.0.0.1:4173",
      "http://localhost:4173",
      "https://public.example.test",
    ]);
  });
});
