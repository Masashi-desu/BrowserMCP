import { describe, expect, it } from "vitest";

import {
  type BridgeMessage,
  createBridgeMessage,
  DEFAULT_MAX_MESSAGE_BYTES,
  isProtocolVersionSupported,
  KNOWN_PROTOCOL_CAPABILITIES,
  type MessagePayloads,
  negotiateCapabilities,
  negotiateProtocolVersion,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  ProtocolValidationError,
  parseBridgeMessage,
  safeParseBridgeMessage,
  serializeBridgeMessage,
} from "../src/index.js";

const connectPayload = {
  supportedVersions: ["1.0.0"],
  capabilities: [...KNOWN_PROTOCOL_CAPABILITIES, "extension.demo"],
  auth: { kind: "pairing", token: "pairing-token-1234567890" },
  app: { id: "example.app", name: "Example App", version: "0.1.0" },
  origin: "https://example.test",
  runtime: {
    id: "runtime-1",
    instanceId: "tab-1",
    userAgent: "Test Browser",
    platform: "test",
    language: "en",
  },
} satisfies MessagePayloads["connect"];

const session = {
  id: "session-1",
  resumeToken: "resume-token-1234567890",
  expiresAt: 1_800_000_000_000,
};

describe("Bridge Protocol messages", () => {
  it("creates and parses a strict connect message", () => {
    const message = createBridgeMessage("connect", connectPayload, {
      id: "message-1",
      timestamp: 1_700_000_000_000,
    });

    expect(message).toEqual({
      protocol: PROTOCOL_ID,
      version: PROTOCOL_VERSION,
      id: "message-1",
      type: "connect",
      timestamp: 1_700_000_000_000,
      payload: connectPayload,
    });
    expect(parseBridgeMessage(JSON.stringify(message))).toEqual(message);
  });

  it("supports resume authentication without retransmitting a pairing token", () => {
    const message = createBridgeMessage("connect", {
      ...connectPayload,
      auth: {
        kind: "resume",
        sessionId: "session-1",
        token: "resume-token-1234567890",
      },
    });

    expect(message.payload.auth).toEqual({
      kind: "resume",
      sessionId: "session-1",
      token: "resume-token-1234567890",
    });
    expect(message.payload).not.toHaveProperty("resume");
  });

  it("supports an operator approval request without a browser credential", () => {
    const message = createBridgeMessage("connect", {
      ...connectPayload,
      auth: { kind: "approval" },
    });

    expect(message.payload.auth).toEqual({ kind: "approval" });
    expect(parseBridgeMessage(message)).toEqual(message);
  });

  it("round-trips every protocol message type", () => {
    const messages: BridgeMessage[] = [
      createBridgeMessage("connect", connectPayload),
      createBridgeMessage("approval_required", {
        requestId: "approval-1",
        origin: "https://example.test",
        expiresAt: 1_800_000_000_000,
      }),
      createBridgeMessage("welcome", {
        selectedVersion: "1.0.0",
        capabilities: ["tools", "heartbeat"],
        session,
        limits: {
          maxMessageBytes: 1_048_576,
          maxConcurrentInvocations: 8,
          requestTimeoutMs: 30_000,
        },
        heartbeatIntervalMs: 15_000,
      }),
      createBridgeMessage("register", {
        sessionId: session.id,
        registration: {
          kind: "tool",
          id: "tool-1",
          name: "example.tool",
          description: "Example",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
          },
          outputSchema: { type: "object" },
          annotations: { readOnlyHint: true },
        },
      }),
      createBridgeMessage("register", {
        sessionId: session.id,
        registration: {
          kind: "resource",
          id: "resource-1",
          name: "example.resource",
          uri: "browsermcp://example/resource",
          mimeType: "text/plain",
        },
      }),
      createBridgeMessage("register", {
        sessionId: session.id,
        registration: {
          kind: "prompt",
          id: "prompt-1",
          name: "example.prompt",
          arguments: [{ name: "topic", required: true }],
        },
      }),
      createBridgeMessage("registered", {
        sessionId: session.id,
        registrationId: "tool-1",
      }),
      createBridgeMessage("unregister", {
        sessionId: session.id,
        registrationId: "tool-1",
      }),
      createBridgeMessage("unregistered", {
        sessionId: session.id,
        registrationId: "tool-1",
      }),
      createBridgeMessage("invoke", {
        sessionId: session.id,
        invocationId: "invocation-1",
        registrationId: "tool-1",
        operation: { kind: "tool.call", arguments: { value: "ok" } },
        timeoutMs: 30_000,
      }),
      createBridgeMessage("invoke", {
        sessionId: session.id,
        invocationId: "invocation-2",
        registrationId: "resource-1",
        operation: {
          kind: "resource.read",
          uri: "browsermcp://example/resource",
        },
        timeoutMs: 30_000,
      }),
      createBridgeMessage("invoke", {
        sessionId: session.id,
        invocationId: "invocation-3",
        registrationId: "prompt-1",
        operation: { kind: "prompt.get", arguments: { topic: "MCP" } },
        timeoutMs: 30_000,
      }),
      createBridgeMessage("result", {
        sessionId: session.id,
        invocationId: "invocation-1",
        output: {
          kind: "tool",
          content: [
            { type: "text", text: "done" },
            {
              type: "resource_link",
              uri: "https://example.test/docs",
              name: "Docs",
            },
          ],
          structuredContent: { ok: true },
        },
        durationMs: 12.5,
      }),
      createBridgeMessage("result", {
        sessionId: session.id,
        invocationId: "invocation-2",
        output: {
          kind: "resource",
          contents: [
            {
              uri: "browsermcp://example/resource",
              mimeType: "text/plain",
              text: "content",
            },
          ],
        },
      }),
      createBridgeMessage("result", {
        sessionId: session.id,
        invocationId: "invocation-3",
        output: {
          kind: "prompt",
          description: "A prompt",
          messages: [{ role: "user", content: { type: "text", text: "Explain MCP" } }],
        },
      }),
      createBridgeMessage("error", {
        sessionId: session.id,
        invocationId: "invocation-1",
        code: "HANDLER_ERROR",
        message: "Handler failed",
        retryable: false,
        details: { category: "application" },
      }),
      createBridgeMessage("cancel", {
        sessionId: session.id,
        invocationId: "invocation-1",
        reason: "Client cancelled",
      }),
      createBridgeMessage("ping", { sessionId: session.id, nonce: "nonce-1" }),
      createBridgeMessage("pong", { sessionId: session.id, nonce: "nonce-1" }),
      createBridgeMessage("disconnect", {
        sessionId: session.id,
        code: "CLIENT_DISCONNECT",
        reason: "Finished",
        canResume: false,
      }),
    ];

    for (const message of messages) {
      expect(parseBridgeMessage(serializeBridgeMessage(message))).toEqual(message);
    }
  });

  it("includes correlation metadata without weakening the envelope", () => {
    const message = createBridgeMessage(
      "pong",
      { nonce: "nonce-1" },
      { id: "message-2", replyTo: "message-1", timestamp: 123 },
    );
    expect(message.replyTo).toBe("message-1");
    expect(parseBridgeMessage(message)).toEqual(message);
  });
});

describe("strict runtime validation", () => {
  const valid = (): BridgeMessage =>
    createBridgeMessage("connect", connectPayload, {
      id: "message-1",
      timestamp: 1,
    });

  it("rejects unknown fields at the envelope and known nested structures", () => {
    expect(() => parseBridgeMessage({ ...valid(), unexpected: true })).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "$.unexpected" }),
    );

    const nested = clone(valid()) as unknown as {
      payload: { app: Record<string, unknown> };
    };
    nested.payload.app.unexpected = true;
    expect(() => parseBridgeMessage(nested)).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "$.payload.app.unexpected" }),
    );
  });

  it("allows arbitrary bounded JSON only in explicitly declared JSON regions", () => {
    const message = createBridgeMessage("register", {
      sessionId: session.id,
      registration: {
        kind: "tool",
        id: "tool-1",
        name: "tool-1",
        inputSchema: {
          customKeyword: { any: [true, 1, null, { nested: "value" }] },
        },
      },
    });
    expect(parseBridgeMessage(message)).toEqual(message);
  });

  it("rejects prototype-pollution keys in arbitrary JSON", () => {
    const message = createBridgeMessage("register", {
      sessionId: session.id,
      registration: {
        kind: "tool",
        id: "tool-1",
        name: "tool-1",
        inputSchema: {},
      },
    });
    const serialized = JSON.stringify(message).replace(
      '"inputSchema":{}',
      '"inputSchema":{"__proto__":{"polluted":true}}',
    );
    expect(() => parseBridgeMessage(serialized)).toThrowError(
      expect.objectContaining({ code: "INVALID_VALUE" }),
    );
  });

  it("rejects invalid JSON, oversized input, deep nesting and non-finite numbers", () => {
    expect(() => parseBridgeMessage("{")).toThrowError(
      expect.objectContaining({ code: "INVALID_JSON" }),
    );
    expect(() => parseBridgeMessage(JSON.stringify(valid()), { maxBytes: 10 })).toThrowError(
      expect.objectContaining({ code: "MESSAGE_TOO_LARGE" }),
    );

    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 6; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const error = createBridgeMessage("error", {
      code: "INTERNAL_ERROR",
      message: "failure",
      retryable: false,
      details: {},
    });
    (error.payload as { details: unknown }).details = deep;
    expect(() => parseBridgeMessage(error, { maxDepth: 3 })).toThrowError(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
    );

    const nonFinite = clone(valid()) as unknown as { timestamp: number };
    nonFinite.timestamp = Number.NaN;
    expect(() => parseBridgeMessage(nonFinite)).toThrowError(
      expect.objectContaining({ code: "INVALID_TYPE" }),
    );
  });

  it("rejects malformed origins, weak auth tokens and ambiguous resource contents", () => {
    expect(() =>
      createBridgeMessage("connect", {
        ...connectPayload,
        origin: "https://example.test/path",
      }),
    ).toThrowError(ProtocolValidationError);
    expect(() =>
      createBridgeMessage("connect", {
        ...connectPayload,
        auth: { kind: "pairing", token: "short" },
      }),
    ).toThrowError(expect.objectContaining({ path: "$.payload.auth.token" }));
    expect(() =>
      createBridgeMessage("result", {
        sessionId: session.id,
        invocationId: "invocation-1",
        output: {
          kind: "resource",
          contents: [
            {
              uri: "browsermcp://example/resource",
              text: "text",
              blob: "YmFzZTY0",
            } as never,
          ],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_VALUE" }));
  });

  it("rejects a welcome message that advertises an unsafe parser limit", () => {
    expect(() =>
      createBridgeMessage("welcome", {
        selectedVersion: "1.0.0",
        capabilities: ["tools"],
        session,
        limits: {
          maxMessageBytes: DEFAULT_MAX_MESSAGE_BYTES + 1,
          maxConcurrentInvocations: 8,
          requestTimeoutMs: 30_000,
        },
        heartbeatIntervalMs: 15_000,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_VALUE",
        path: "$.payload.limits.maxMessageBytes",
      }),
    );
  });

  it("requires canonical Base64 for image, audio, and resource blob results", () => {
    const invalidOutputs = [
      {
        kind: "tool" as const,
        content: [{ type: "image" as const, data: "x", mimeType: "image/png" }],
      },
      {
        kind: "tool" as const,
        content: [{ type: "audio" as const, data: "YQ", mimeType: "audio/wav" }],
      },
      {
        kind: "resource" as const,
        contents: [{ uri: "browsermcp://example/blob", blob: "AB==" }],
      },
    ];
    for (const output of invalidOutputs) {
      expect(() =>
        createBridgeMessage("result", {
          sessionId: session.id,
          invocationId: "invocation-base64",
          output,
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_VALUE" }));
    }

    expect(() =>
      createBridgeMessage("result", {
        sessionId: session.id,
        invocationId: "invocation-empty-base64",
        output: {
          kind: "tool",
          content: [{ type: "image", data: "", mimeType: "image/png" }],
        },
      }),
    ).not.toThrow();
    expect(() =>
      createBridgeMessage("result", {
        sessionId: session.id,
        invocationId: "invocation-structured-array",
        output: {
          kind: "tool",
          content: [],
          structuredContent: ["modern", 2026, true],
        },
      }),
    ).not.toThrow();
  });

  it("rejects unsupported envelopes by default and permits explicit negotiation parsing", () => {
    const message = { ...valid(), version: "2.0.0" };
    expect(() => parseBridgeMessage(message)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION", path: "$.version" }),
    );
    expect(parseBridgeMessage(message, { allowUnsupportedVersion: true }).version).toBe("2.0.0");
  });

  it("returns validation errors without throwing through safeParse", () => {
    const result = safeParseBridgeMessage({ type: "connect" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ProtocolValidationError);
      expect(result.error.message).not.toContain(connectPayload.auth.token);
    }
  });
});

describe("version and capability negotiation", () => {
  it("selects the highest exact common version", () => {
    expect(negotiateProtocolVersion(["1.0.0", "2.0.0", "1.2.0"], ["1.0.0", "1.1.0", "1.2.0"])).toBe(
      "1.2.0",
    );
    expect(negotiateProtocolVersion(["2.0.0"], ["1.0.0"])).toBeUndefined();
    expect(
      negotiateProtocolVersion(
        ["1.0.0-alpha", "1.0.0", "1.0.0-alpha.10", "1.0.0-alpha.2"],
        ["1.0.0-alpha", "1.0.0", "1.0.0-alpha.10", "1.0.0-alpha.2"],
      ),
    ).toBe("1.0.0");
    expect(
      negotiateProtocolVersion(
        ["1.0.0-alpha.2", "1.0.0-alpha.10"],
        ["1.0.0-alpha.2", "1.0.0-alpha.10"],
      ),
    ).toBe("1.0.0-alpha.10");
    expect(isProtocolVersionSupported("1.0.0")).toBe(true);
    expect(isProtocolVersionSupported("1.0.1")).toBe(false);
  });

  it("intersects capabilities, preserves request order and removes duplicates", () => {
    expect(
      negotiateCapabilities(
        ["prompts", "tools", "prompts", "extension.unknown"],
        ["tools", "prompts"],
      ),
    ).toEqual(["prompts", "tools"]);
  });
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
