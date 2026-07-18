import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "../../src/config.js";
import { BridgeError } from "../../src/errors.js";
import { type BrowserSession, CapabilityRegistry } from "../../src/registry.js";

function session(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    app: { id: "docs", name: "Docs", version: "1.0.0" },
    capabilities: ["tools", "resources", "prompts"],
    connectedAt: "2026-07-18T00:00:00.000Z",
    connectionId: "connection-1",
    origin: "https://docs.example.test",
    protocolVersion: "1.0.0",
    runtime: { id: "runtime-1", instanceId: "tab-1" },
    sessionId: "session-1",
    ...overrides,
  };
}

describe("capability registry", () => {
  it("namespaces capabilities by app and origin and removes them on disconnect", () => {
    const registry = new CapabilityRegistry();
    registry.addSession(session());
    const tool = registry.register("connection-1", {
      kind: "tool",
      id: "tool-1",
      name: "search",
      inputSchema: { type: "object" },
    });
    const resource = registry.register("connection-1", {
      kind: "resource",
      id: "resource-1",
      name: "Guide",
      uri: "docs://guide",
    });

    expect(tool.exposedName).toMatch(/^docs_[a-f0-9]{16}_[a-f0-9]{16}__search$/);
    expect(resource.exposedUri).toMatch(/^browsermcp:\/\/app-[a-f0-9]{16}-[a-f0-9]{16}\//);
    expect(registry.snapshot().tools).toHaveLength(1);
    expect(registry.removeSession("connection-1")).toHaveLength(2);
    expect(registry.snapshot().tools).toHaveLength(0);
  });

  it("keeps MCP names within 128 characters and rejects normalization collisions", () => {
    const registry = new CapabilityRegistry();
    registry.addSession(session({ app: { id: "a".repeat(128), name: "Long", version: "1.0.0" } }));
    const first = registry.register("connection-1", {
      kind: "tool",
      id: "first",
      name: "x".repeat(128),
      inputSchema: {},
    });
    expect(first.exposedName.length).toBeLessThanOrEqual(128);
    expect(() =>
      registry.register("connection-1", {
        kind: "tool",
        id: "second",
        name: `${"x".repeat(127)}y`,
        inputSchema: {},
      }),
    ).toThrowError(BridgeError);
  });

  it("reports same-app duplicate tabs as an explicit ambiguous target", () => {
    const registry = new CapabilityRegistry();
    registry.addSession(session());
    registry.addSession(
      session({
        connectionId: "connection-2",
        runtime: { id: "runtime-2", instanceId: "tab-2" },
        sessionId: "session-2",
      }),
    );
    const registration = {
      kind: "tool" as const,
      id: "search",
      name: "search",
      inputSchema: {},
    };
    const first = registry.register("connection-1", registration);
    registry.register("connection-2", registration);

    expect(() =>
      registry.resolveUnique(
        registry.providersByName("tool", first.exposedName),
        first.exposedName,
      ),
    ).toThrowError(/multiple tabs/);
  });

  it("keeps apps distinct when their sanitized or truncated labels collide", () => {
    const registry = new CapabilityRegistry();
    const prefix = "same-label-".repeat(5);
    registry.addSession(session({ app: { id: `${prefix}one`, name: "One", version: "1.0.0" } }));
    registry.addSession(
      session({
        app: { id: `${prefix}two`, name: "Two", version: "1.0.0" },
        connectionId: "connection-2",
        runtime: { id: "runtime-2", instanceId: "tab-2" },
        sessionId: "session-2",
      }),
    );
    const first = registry.register("connection-1", {
      kind: "tool",
      id: "search",
      name: "search",
      inputSchema: {},
    });
    const second = registry.register("connection-2", {
      kind: "tool",
      id: "search",
      name: "search",
      inputSchema: {},
    });
    expect(first.exposedName).not.toBe(second.exposedName);
  });

  it("uses distinct 64-bit namespaces for the same app on different origins", () => {
    const registry = new CapabilityRegistry();
    registry.addSession(session());
    registry.addSession(
      session({
        connectionId: "connection-2",
        origin: "https://other-docs.example.test",
        runtime: { id: "runtime-2", instanceId: "tab-2" },
        sessionId: "session-2",
      }),
    );
    const first = registry.register("connection-1", {
      kind: "resource",
      id: "guide",
      name: "Guide",
      uri: "docs://guide",
    });
    const second = registry.register("connection-2", {
      kind: "resource",
      id: "guide",
      name: "Guide",
      uri: "docs://guide",
    });
    expect(first.exposedName).not.toBe(second.exposedName);
    expect(first.exposedUri).not.toBe(second.exposedUri);
  });

  it("rejects duplicate exact resource URIs inside one runtime before MCP listing", () => {
    const registry = new CapabilityRegistry();
    registry.addSession(session());
    registry.register("connection-1", {
      kind: "resource",
      id: "guide-one",
      name: "Guide one",
      uri: "docs://guide",
    });
    expect(() =>
      registry.register("connection-1", {
        kind: "resource",
        id: "guide-two",
        name: "Guide two",
        uri: "docs://guide",
      }),
    ).toThrowError(/Resource URI collides/u);
    expect(registry.snapshot().resources).toHaveLength(1);
  });

  it("atomically enforces per-runtime and total registration counts", () => {
    const registry = new CapabilityRegistry({
      ...DEFAULT_LIMITS,
      maxRegistrationsPerRuntime: 1,
      maxRegistrationsTotal: 1,
    });
    registry.addSession(session());
    registry.addSession(
      session({
        connectionId: "connection-2",
        runtime: { id: "runtime-2", instanceId: "tab-2" },
        sessionId: "session-2",
      }),
    );
    registry.register("connection-1", {
      kind: "tool",
      id: "first",
      name: "first",
      inputSchema: {},
    });
    const before = registry.usage;
    expect(() =>
      registry.register("connection-1", {
        kind: "tool",
        id: "second",
        name: "second",
        inputSchema: {},
      }),
    ).toThrowError(/Runtime registration count limit/);
    expect(() =>
      registry.register("connection-2", {
        kind: "tool",
        id: "other",
        name: "other",
        inputSchema: {},
      }),
    ).toThrowError(/Bridge registration count limit/);
    expect(registry.usage).toEqual(before);
    expect(registry.snapshot().tools).toHaveLength(1);
  });

  it("atomically enforces retained registration bytes and releases usage", () => {
    const small = {
      kind: "tool" as const,
      id: "small",
      name: "small",
      inputSchema: {},
    };
    const smallBytes = Buffer.byteLength(JSON.stringify(small), "utf8");
    const registry = new CapabilityRegistry({
      ...DEFAULT_LIMITS,
      maxRegistrationBytesPerRuntime: smallBytes + 10,
      maxRegistrationBytesTotal: smallBytes + 10,
    });
    registry.addSession(session());
    registry.register("connection-1", small);
    const before = registry.usage;
    expect(() =>
      registry.register("connection-1", {
        kind: "tool",
        id: "large",
        name: "large",
        description: "x".repeat(100),
        inputSchema: {},
      }),
    ).toThrowError(/registration byte limit/);
    expect(registry.usage).toEqual(before);
    registry.unregister("connection-1", "small");
    expect(registry.usage).toEqual({ registrations: 0, retainedBytes: 0 });
  });
});
