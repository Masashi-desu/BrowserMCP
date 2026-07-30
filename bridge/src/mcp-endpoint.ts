import type { IncomingMessage, ServerResponse } from "node:http";
import type { JsonObject } from "@browsermcp/protocol";
import {
  type Annotations,
  type CallToolResult,
  createMcpHandler,
  type GetPromptResult,
  InMemoryServerEventBus,
  type McpHttpHandler,
  ProtocolError,
  ProtocolErrorCode,
  type ReadResourceResult,
  Server,
  specTypeSchemas,
  type Tool,
} from "@modelcontextprotocol/server";

import type { InvocationBroker } from "./broker.js";
import { BridgeError } from "./errors.js";
import { type RingLogger, safeText } from "./logger.js";
import type {
  CapabilityRegistry,
  PromptRegistration,
  RegisteredCapability,
  ResourceRegistration,
  ToolRegistration,
} from "./registry.js";

export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonSchema(
  schema: Record<string, unknown>,
  options: { forceObjectRoot: boolean },
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    ...schema,
    ...(options.forceObjectRoot ? { type: "object" } : {}),
  };
  if ("properties" in sanitized) {
    if (!isObject(sanitized.properties)) {
      delete sanitized.properties;
    } else {
      sanitized.properties = Object.fromEntries(
        Object.entries(sanitized.properties).filter((entry) => isObject(entry[1])),
      );
    }
  }
  if ("required" in sanitized) {
    if (!Array.isArray(sanitized.required)) delete sanitized.required;
    else sanitized.required = sanitized.required.filter((name) => typeof name === "string");
  }
  return sanitized;
}

function toolAnnotations(value: Record<string, unknown> | undefined): Tool["annotations"] {
  if (!value) return undefined;
  const filtered: Record<string, unknown> = {};
  if (typeof value.title === "string") filtered.title = value.title;
  for (const key of [
    "readOnlyHint",
    "destructiveHint",
    "idempotentHint",
    "openWorldHint",
  ] as const) {
    if (typeof value[key] === "boolean") filtered[key] = value[key];
  }
  const parsed = specTypeSchemas.ToolAnnotations["~standard"].validate(filtered);
  return parsed.issues === undefined && Object.keys(parsed.value).length > 0
    ? parsed.value
    : undefined;
}

function resourceAnnotations(value: Record<string, unknown> | undefined): Annotations | undefined {
  if (!value) return undefined;
  const filtered: Record<string, unknown> = {};
  if (Array.isArray(value.audience)) {
    const audience = value.audience.filter(
      (role): role is "assistant" | "user" => role === "assistant" || role === "user",
    );
    if (audience.length > 0) filtered.audience = audience;
  }
  if (typeof value.priority === "number" && value.priority >= 0 && value.priority <= 1) {
    filtered.priority = value.priority;
  }
  if (typeof value.lastModified === "string") filtered.lastModified = value.lastModified;
  let parsed = specTypeSchemas.Annotations["~standard"].validate(filtered);
  if (parsed.issues !== undefined) {
    delete filtered.lastModified;
    parsed = specTypeSchemas.Annotations["~standard"].validate(filtered);
  }
  return parsed.issues === undefined && Object.keys(parsed.value).length > 0
    ? parsed.value
    : undefined;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function mcpError(error: unknown): ProtocolError {
  if (error instanceof BridgeError) {
    const code =
      error.code === "NOT_FOUND"
        ? ProtocolErrorCode.InvalidParams
        : ProtocolErrorCode.InternalError;
    return new ProtocolError(code, safeText(error.message), { bridgeCode: error.code });
  }
  return new ProtocolError(
    ProtocolErrorCode.InternalError,
    error instanceof Error ? safeText(error.message) : "Browser invocation failed",
  );
}

export class McpEndpoint {
  readonly #broker: InvocationBroker;
  readonly #bus: InMemoryServerEventBus;
  #closed = false;
  readonly #handler: McpHttpHandler;
  readonly #logger: RingLogger;
  readonly #pendingNotifications = new Set<"prompts" | "resources" | "tools">();
  readonly #registry: CapabilityRegistry;
  #notificationTimer?: NodeJS.Timeout;

  public constructor(options: {
    broker: InvocationBroker;
    logger: RingLogger;
    maxSubscriptions: number;
    registry: CapabilityRegistry;
  }) {
    this.#broker = options.broker;
    this.#logger = options.logger;
    this.#registry = options.registry;
    const onerror = (error: Error): void => {
      this.#logger.warn("MCP request rejected", { message: safeText(error.message) });
    };
    this.#bus = new InMemoryServerEventBus(onerror);
    this.#handler = createMcpHandler(() => this.createServer(), {
      bus: this.#bus,
      legacy: "reject",
      maxSubscriptions: options.maxSubscriptions,
      onerror,
      responseMode: "auto",
    });
    options.registry.on("toolsChanged", () => this.queueNotification("tools"));
    options.registry.on("resourcesChanged", () => this.queueNotification("resources"));
    options.registry.on("promptsChanged", () => this.queueNotification("prompts"));
  }

  public async handle(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    let finished = false;
    const abort = new AbortController();
    response.on("close", () => {
      if (!finished) abort.abort();
    });
    if (response.destroyed) abort.abort();

    let webResponse: Response;
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else {
          headers.set(name, value);
        }
      }
      const encrypted = "encrypted" in request.socket && request.socket.encrypted === true;
      const url = `${encrypted ? "https" : "http"}://${request.headers.host ?? "127.0.0.1"}${request.url ?? "/mcp"}`;
      const webRequest = new Request(url, {
        method: request.method,
        headers,
        ...(parsedBody === undefined ? {} : { body: JSON.stringify(parsedBody) }),
        signal: abort.signal,
      });
      webResponse = await this.#handler.fetch(webRequest, {
        ...(parsedBody === undefined ? {} : { parsedBody }),
      });
    } catch (error) {
      this.#logger.warn("MCP HTTP adapter failed", {
        message: error instanceof Error ? safeText(error.message) : safeText(String(error)),
      });
      webResponse = new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: ProtocolErrorCode.InternalError, message: "Internal Server Error" },
          id: null,
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    const responseHeaders: Record<string, string> = {};
    for (const [name, value] of webResponse.headers) responseHeaders[name] = value;
    response.writeHead(webResponse.status, responseHeaders);
    if (webResponse.body === null) {
      finished = true;
      response.end();
      return;
    }

    const reader = webResponse.body.getReader();
    try {
      while (!abort.signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        if (!response.write(next.value)) {
          await Promise.race([
            new Promise<void>((resolve) => response.once("drain", resolve)),
            new Promise<void>((resolve) =>
              abort.signal.addEventListener("abort", () => resolve(), { once: true }),
            ),
          ]);
        }
      }
    } finally {
      if (abort.signal.aborted) await reader.cancel().catch(() => undefined);
      finished = true;
      response.end();
    }
  }

  public async close(): Promise<void> {
    this.#closed = true;
    if (this.#notificationTimer) clearTimeout(this.#notificationTimer);
    this.#notificationTimer = undefined;
    this.#pendingNotifications.clear();
    await this.#handler.close();
  }

  public get subscriptionCount(): number {
    return this.#bus.listenerCount;
  }

  private createServer(): Server {
    const server = new Server(
      { name: "BrowserMCP Bridge", version: "0.1.0" },
      {
        cacheHints: {
          "prompts/list": { cacheScope: "private", ttlMs: 0 },
          "resources/list": { cacheScope: "private", ttlMs: 0 },
          "resources/read": { cacheScope: "private", ttlMs: 0 },
          "server/discover": { cacheScope: "private", ttlMs: 0 },
          "tools/list": { cacheScope: "private", ttlMs: 0 },
        },
        capabilities: {
          prompts: { listChanged: true },
          resources: { listChanged: true },
          tools: { listChanged: true },
        },
        instructions:
          "BrowserMCP capabilities execute in connected browser tabs. Names include app and origin namespaces. Duplicate tabs produce an explicit ambiguous-target error.",
      },
    );

    server.setRequestHandler("tools/list", async () => ({
      tools: uniqueBy(this.#registry.snapshot().tools, (item) => item.exposedName).map((item) =>
        this.toMcpTool(item),
      ),
    }));

    server.setRequestHandler("tools/call", async (request, context): Promise<CallToolResult> => {
      let provider: RegisteredCapability<ToolRegistration>;
      try {
        provider = this.#registry.resolveUnique(
          this.#registry.providersByName(
            "tool",
            request.params.name,
          ) as readonly RegisteredCapability<ToolRegistration>[],
          request.params.name,
        );
      } catch (error) {
        throw mcpError(error);
      }
      try {
        const output = await this.#broker.invoke(
          provider,
          {
            kind: "tool.call",
            arguments: (request.params.arguments ?? {}) as JsonObject,
          },
          context.mcpReq.signal,
        );
        if (output.kind !== "tool") throw new Error("Browser returned the wrong result kind");
        const parsed = specTypeSchemas.CallToolResult["~standard"].validate({
          content: output.content,
          ...(output.structuredContent === undefined
            ? {}
            : { structuredContent: output.structuredContent }),
          ...(output.isError === undefined ? {} : { isError: output.isError }),
        });
        if (parsed.issues !== undefined) {
          throw new BridgeError("INVALID_MESSAGE", "Browser returned an invalid MCP tool result");
        }
        return server.projectCallToolResult(
          parsed.value,
          provider.registration.outputSchema
            ? jsonSchema(provider.registration.outputSchema, { forceObjectRoot: false })
            : undefined,
        );
      } catch (error) {
        const converted = error instanceof BridgeError ? error : undefined;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: converted?.code ?? "BROWSER_ERROR",
                message:
                  error instanceof Error ? safeText(error.message) : "Browser invocation failed",
              }),
            },
          ],
          isError: true,
        };
      }
    });

    server.setRequestHandler("resources/list", async () => ({
      resources: uniqueBy(
        this.#registry.snapshot().resources,
        (item) => item.exposedUri ?? item.exposedName,
      ).map(({ exposedName, exposedUri, registration, session }) => {
        const annotations = resourceAnnotations(registration.annotations);
        return {
          uri: exposedUri ?? registration.uri,
          name: exposedName,
          title: registration.title ?? registration.name,
          ...(registration.description ? { description: registration.description } : {}),
          ...(registration.mimeType ? { mimeType: registration.mimeType } : {}),
          ...(annotations ? { annotations } : {}),
          _meta: {
            "browsermcp/appId": session.app.id,
            "browsermcp/origin": session.origin,
            "browsermcp/sourceUri": registration.uri,
          },
        };
      }),
    }));

    server.setRequestHandler(
      "resources/read",
      async (request, context): Promise<ReadResourceResult> => {
        try {
          const provider = this.#registry.resolveUnique(
            this.#registry.providersByUri(
              request.params.uri,
            ) as readonly RegisteredCapability<ResourceRegistration>[],
            request.params.uri,
          );
          const output = await this.#broker.invoke(
            provider,
            { kind: "resource.read", uri: provider.registration.uri },
            context.mcpReq.signal,
          );
          if (output.kind !== "resource") throw new Error("Browser returned the wrong result kind");
          if (output.contents.some((content) => content.uri !== provider.registration.uri)) {
            throw new BridgeError(
              "INVALID_MESSAGE",
              "Browser returned resource content for an unexpected URI",
            );
          }
          const parsed = specTypeSchemas.ReadResourceResult["~standard"].validate({
            contents: output.contents.map((content) => ({
              ...content,
              uri: request.params.uri,
            })),
          });
          if (parsed.issues !== undefined) {
            throw new BridgeError(
              "INVALID_MESSAGE",
              "Browser returned an invalid MCP resource result",
            );
          }
          return parsed.value;
        } catch (error) {
          throw mcpError(error);
        }
      },
    );

    server.setRequestHandler("prompts/list", async () => ({
      prompts: uniqueBy(this.#registry.snapshot().prompts, (item) => item.exposedName).map(
        ({ exposedName, registration, session }) => ({
          name: exposedName,
          title: registration.title ?? registration.name,
          ...(registration.description ? { description: registration.description } : {}),
          ...(registration.arguments
            ? { arguments: registration.arguments.map((argument) => ({ ...argument })) }
            : {}),
          _meta: {
            "browsermcp/appId": session.app.id,
            "browsermcp/origin": session.origin,
          },
        }),
      ),
    }));

    server.setRequestHandler("prompts/get", async (request, context): Promise<GetPromptResult> => {
      try {
        const provider = this.#registry.resolveUnique(
          this.#registry.providersByName(
            "prompt",
            request.params.name,
          ) as readonly RegisteredCapability<PromptRegistration>[],
          request.params.name,
        );
        const output = await this.#broker.invoke(
          provider,
          {
            kind: "prompt.get",
            ...(request.params.arguments ? { arguments: request.params.arguments } : {}),
          },
          context.mcpReq.signal,
        );
        if (output.kind !== "prompt") throw new Error("Browser returned the wrong result kind");
        const parsed = specTypeSchemas.GetPromptResult["~standard"].validate({
          ...(output.description ? { description: output.description } : {}),
          messages: output.messages,
        });
        if (parsed.issues !== undefined) {
          throw new BridgeError("INVALID_MESSAGE", "Browser returned an invalid MCP prompt result");
        }
        return parsed.value;
      } catch (error) {
        throw mcpError(error);
      }
    });

    return server;
  }

  private notify(kind: "prompts" | "resources" | "tools"): void {
    if (kind === "tools") this.#handler.notify.toolsChanged();
    else if (kind === "resources") this.#handler.notify.resourcesChanged();
    else this.#handler.notify.promptsChanged();
  }

  private queueNotification(kind: "prompts" | "resources" | "tools"): void {
    if (this.#closed) return;
    this.#pendingNotifications.add(kind);
    if (this.#notificationTimer) return;
    this.#notificationTimer = setTimeout(() => {
      this.#notificationTimer = undefined;
      const pending = [...this.#pendingNotifications];
      this.#pendingNotifications.clear();
      for (const pendingKind of pending) this.notify(pendingKind);
    }, 25);
    this.#notificationTimer.unref();
  }

  private toMcpTool({
    exposedName,
    registration,
    session,
  }: RegisteredCapability<ToolRegistration>): Tool {
    const annotations = toolAnnotations(registration.annotations);
    const candidate = {
      name: exposedName,
      title: registration.title ?? registration.name,
      ...(registration.description ? { description: registration.description } : {}),
      inputSchema: jsonSchema(registration.inputSchema, { forceObjectRoot: true }),
      ...(registration.outputSchema
        ? {
            outputSchema: jsonSchema(registration.outputSchema, {
              forceObjectRoot: false,
            }),
          }
        : {}),
      ...(annotations ? { annotations } : {}),
      _meta: {
        "browsermcp/appId": session.app.id,
        "browsermcp/origin": session.origin,
      },
    };
    const parsed = specTypeSchemas.Tool["~standard"].validate(candidate);
    if (parsed.issues === undefined) return parsed.value;
    this.#logger.warn("Filtered invalid browser tool metadata", {
      appId: session.app.id,
      registrationId: registration.id,
    });
    const fallback = specTypeSchemas.Tool["~standard"].validate({
      name: exposedName,
      inputSchema: { type: "object" },
      _meta: candidate._meta,
    });
    if (fallback.issues === undefined) return fallback.value;
    throw new Error("Could not construct fallback MCP tool metadata");
  }
}
