import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { JsonObject } from "@browsermcp/protocol";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  type Annotations,
  AnnotationsSchema,
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
  ErrorCode,
  GetPromptRequestSchema,
  type GetPromptResult,
  GetPromptResultSchema,
  isInitializeRequest,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type ReadResourceResult,
  ReadResourceResultSchema,
  type Tool,
  ToolAnnotationsSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

interface McpSession {
  activeRequests: number;
  closing: boolean;
  lastUsedAt: number;
  readonly server: Server;
  readonly transport: StreamableHTTPServerTransport;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> & { type: "object" } {
  const sanitized: Record<string, unknown> & { type: "object" } = {
    ...schema,
    type: "object",
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
  const parsed = ToolAnnotationsSchema.safeParse(filtered);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
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
  const parsed = AnnotationsSchema.safeParse(filtered);
  if (!parsed.success) delete filtered.lastModified;
  const recovered = AnnotationsSchema.safeParse(filtered);
  return recovered.success && Object.keys(recovered.data).length > 0 ? recovered.data : undefined;
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

function mcpError(error: unknown): McpError {
  if (error instanceof BridgeError) {
    const code = error.code === "NOT_FOUND" ? ErrorCode.InvalidParams : ErrorCode.InternalError;
    return new McpError(code, safeText(error.message), { bridgeCode: error.code });
  }
  return new McpError(
    ErrorCode.InternalError,
    error instanceof Error ? safeText(error.message) : "Browser invocation failed",
  );
}

export class McpEndpoint {
  readonly #broker: InvocationBroker;
  #closed = false;
  readonly #idleTtlMs: number;
  #initializing = 0;
  readonly #logger: RingLogger;
  readonly #maxSessions: number;
  readonly #now: () => number;
  readonly #pendingNotifications = new Set<"prompts" | "resources" | "tools">();
  readonly #registry: CapabilityRegistry;
  readonly #sessions = new Map<string, McpSession>();
  #notificationTimer?: NodeJS.Timeout;
  readonly #sweepTimer: NodeJS.Timeout;

  public constructor(options: {
    broker: InvocationBroker;
    logger: RingLogger;
    maxSessions: number;
    now?: () => number;
    registry: CapabilityRegistry;
    sessionIdleTtlMs: number;
    sessionSweepIntervalMs: number;
  }) {
    this.#broker = options.broker;
    this.#logger = options.logger;
    this.#maxSessions = options.maxSessions;
    this.#idleTtlMs = options.sessionIdleTtlMs;
    this.#now = options.now ?? Date.now;
    this.#registry = options.registry;
    options.registry.on("toolsChanged", () => this.queueNotification("tools"));
    options.registry.on("resourcesChanged", () => this.queueNotification("resources"));
    options.registry.on("promptsChanged", () => this.queueNotification("prompts"));
    this.#sweepTimer = setInterval(
      () => void this.sweepIdleSessions(),
      options.sessionSweepIntervalMs,
    );
    this.#sweepTimer.unref();
  }

  public async handle(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    const header = request.headers["mcp-session-id"];
    const sessionId = typeof header === "string" ? header : undefined;

    if (request.method === "POST" && !sessionId && isInitializeRequest(parsedBody)) {
      await this.sweepIdleSessions();
      if (this.#sessions.size + this.#initializing >= this.#maxSessions) {
        this.jsonError(response, 429, -32_000, "MCP session limit reached");
        return;
      }
      this.#initializing += 1;
      try {
        await this.initialize(request, response, parsedBody);
      } finally {
        this.#initializing -= 1;
      }
      return;
    }

    if (!sessionId) {
      this.jsonError(response, 400, -32_600, "Mcp-Session-Id header is required");
      return;
    }
    const session = this.#sessions.get(sessionId);
    if (!session) {
      this.jsonError(response, 404, -32_000, "Unknown or expired MCP session");
      return;
    }
    session.activeRequests += 1;
    session.lastUsedAt = this.#now();
    try {
      await session.transport.handleRequest(request, response, parsedBody);
    } finally {
      session.activeRequests = Math.max(0, session.activeRequests - 1);
      session.lastUsedAt = this.#now();
    }
  }

  public async close(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#sweepTimer);
    if (this.#notificationTimer) clearTimeout(this.#notificationTimer);
    this.#notificationTimer = undefined;
    this.#pendingNotifications.clear();
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(
      sessions.flatMap(({ server, transport }) => [transport.close(), server.close()]),
    );
  }

  public get sessionCount(): number {
    return this.#sessions.size;
  }

  private async initialize(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    let createdSessionId: string | undefined;
    const server = this.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        createdSessionId = sessionId;
        this.#sessions.set(sessionId, {
          activeRequests: 0,
          closing: false,
          lastUsedAt: this.#now(),
          server,
          transport,
        });
        this.#logger.info("MCP session initialized", { sessionId });
      },
    });
    transport.onclose = () => {
      if (createdSessionId) {
        const current = this.#sessions.get(createdSessionId);
        if (current?.transport === transport) this.#sessions.delete(createdSessionId);
        this.#logger.info("MCP session closed", { sessionId: createdSessionId });
      }
    };
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, parsedBody);
      if (!createdSessionId) await Promise.allSettled([transport.close(), server.close()]);
    } catch (error) {
      if (createdSessionId) this.#sessions.delete(createdSessionId);
      await Promise.allSettled([transport.close(), server.close()]);
      throw error;
    }
  }

  private createServer(): Server {
    const server = new Server(
      { name: "BrowserMCP Bridge", version: "0.1.0" },
      {
        capabilities: {
          prompts: { listChanged: true },
          resources: { listChanged: true },
          tools: { listChanged: true },
        },
        instructions:
          "BrowserMCP capabilities execute in connected browser tabs. Names include app and origin namespaces. Duplicate tabs produce an explicit ambiguous-target error.",
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: uniqueBy(this.#registry.snapshot().tools, (item) => item.exposedName).map((item) =>
        this.toMcpTool(item),
      ),
    }));

    server.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra): Promise<CallToolResult> => {
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
            extra.signal,
          );
          if (output.kind !== "tool") throw new Error("Browser returned the wrong result kind");
          const parsed = CallToolResultSchema.safeParse({
            content: output.content,
            ...(output.structuredContent ? { structuredContent: output.structuredContent } : {}),
            ...(output.isError === undefined ? {} : { isError: output.isError }),
          });
          if (!parsed.success) {
            throw new BridgeError("INVALID_MESSAGE", "Browser returned an invalid MCP tool result");
          }
          return parsed.data as CallToolResult;
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
      },
    );

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
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
      ReadResourceRequestSchema,
      async (request, extra): Promise<ReadResourceResult> => {
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
            extra.signal,
          );
          if (output.kind !== "resource") throw new Error("Browser returned the wrong result kind");
          if (output.contents.some((content) => content.uri !== provider.registration.uri)) {
            throw new BridgeError(
              "INVALID_MESSAGE",
              "Browser returned resource content for an unexpected URI",
            );
          }
          const parsed = ReadResourceResultSchema.safeParse({
            contents: output.contents.map((content) => ({
              ...content,
              uri: request.params.uri,
            })),
          });
          if (!parsed.success) {
            throw new BridgeError(
              "INVALID_MESSAGE",
              "Browser returned an invalid MCP resource result",
            );
          }
          return parsed.data as ReadResourceResult;
        } catch (error) {
          throw mcpError(error);
        }
      },
    );

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: uniqueBy(this.#registry.snapshot().prompts, (item) => item.exposedName).map(
        ({ exposedName, registration, session }) => ({
          name: exposedName,
          title: registration.title ?? registration.name,
          ...(registration.description ? { description: registration.description } : {}),
          ...(registration.arguments ? { arguments: registration.arguments } : {}),
          _meta: {
            "browsermcp/appId": session.app.id,
            "browsermcp/origin": session.origin,
          },
        }),
      ),
    }));

    server.setRequestHandler(
      GetPromptRequestSchema,
      async (request, extra): Promise<GetPromptResult> => {
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
            extra.signal,
          );
          if (output.kind !== "prompt") throw new Error("Browser returned the wrong result kind");
          const parsed = GetPromptResultSchema.safeParse({
            ...(output.description ? { description: output.description } : {}),
            messages: output.messages,
          });
          if (!parsed.success) {
            throw new BridgeError(
              "INVALID_MESSAGE",
              "Browser returned an invalid MCP prompt result",
            );
          }
          return parsed.data as GetPromptResult;
        } catch (error) {
          throw mcpError(error);
        }
      },
    );

    return server;
  }

  private notify(kind: "prompts" | "resources" | "tools"): void {
    for (const { server } of this.#sessions.values()) {
      const notification =
        kind === "tools"
          ? server.sendToolListChanged()
          : kind === "resources"
            ? server.sendResourceListChanged()
            : server.sendPromptListChanged();
      void notification.catch((error: unknown) => {
        this.#logger.warn(`Could not send ${kind} list_changed notification`, {
          message: error instanceof Error ? safeText(error.message) : safeText(String(error)),
        });
      });
    }
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
      inputSchema: objectSchema(registration.inputSchema),
      ...(registration.outputSchema
        ? { outputSchema: objectSchema(registration.outputSchema) }
        : {}),
      ...(annotations ? { annotations } : {}),
      _meta: {
        "browsermcp/appId": session.app.id,
        "browsermcp/origin": session.origin,
      },
    };
    const parsed = ToolSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    this.#logger.warn("Filtered invalid browser tool metadata", {
      appId: session.app.id,
      registrationId: registration.id,
    });
    return ToolSchema.parse({
      name: exposedName,
      inputSchema: { type: "object" },
      _meta: candidate._meta,
    });
  }

  private async sweepIdleSessions(): Promise<void> {
    const now = this.#now();
    const expired: Array<[string, McpSession]> = [];
    for (const [sessionId, session] of this.#sessions) {
      if (
        !session.closing &&
        session.activeRequests === 0 &&
        now - session.lastUsedAt >= this.#idleTtlMs
      ) {
        session.closing = true;
        this.#sessions.delete(sessionId);
        expired.push([sessionId, session]);
      }
    }
    await Promise.all(
      expired.map(async ([sessionId, { server, transport }]) => {
        await Promise.allSettled([transport.close(), server.close()]);
        this.#logger.info("Expired idle MCP session", { sessionId });
      }),
    );
  }

  private jsonError(response: ServerResponse, status: number, code: number, message: string): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
  }
}
