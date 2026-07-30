import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { InvocationBroker } from "./broker.js";
import { BrowserGateway } from "./browser-gateway.js";
import { type BridgeConfig, type BridgeLimits, normalizeBridgeConfig } from "./config.js";
import { type LogEntry, RingLogger, redact } from "./logger.js";
import { McpEndpoint, MCP_PROTOCOL_VERSION } from "./mcp-endpoint.js";
import { AllowedOrigins } from "./origins.js";
import { RecentRequestStore } from "./recent-requests.js";
import { CapabilityRegistry } from "./registry.js";
import {
  AdminAuthenticator,
  bearerToken,
  createSecret,
  normalizeWebOrigin,
  parseCookies,
  SecretVerifier,
} from "./security.js";
import { renderStateUi } from "./state-ui.js";

const UI_COOKIE = "browsermcp_ui";
const MAX_HTTP_HEADERS = 100;
const MAX_REQUESTS_PER_SOCKET = 1_000;
const MAX_TIMEOUT_CHECK_INTERVAL_MS = 1_000;

type LocalServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

export function configureHttpServer(server: LocalServer, limits: BridgeLimits): void {
  server.maxConnections = limits.maxHttpConnections;
  server.requestTimeout = limits.httpRequestTimeoutMs;
  server.headersTimeout = limits.httpHeadersTimeoutMs;
  server.keepAliveTimeout = limits.httpKeepAliveTimeoutMs;
  server.maxHeadersCount = MAX_HTTP_HEADERS;
  server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;
  (
    server as LocalServer & {
      connectionsCheckingInterval: number;
    }
  ).connectionsCheckingInterval = Math.min(
    MAX_TIMEOUT_CHECK_INTERVAL_MS,
    limits.httpHeadersTimeoutMs,
    limits.httpRequestTimeoutMs,
  );
  // Streamable HTTP POST/SSE subscriptions and browser invocations can legitimately remain active.
  // Header/request intake has separate finite deadlines above.
  server.timeout = 0;
}

export interface BridgeAddress {
  readonly adminToken: string;
  readonly browserEndpoint: string;
  readonly host: string;
  readonly mcpEndpoint: string;
  readonly mcpToken: string;
  readonly port: number;
  readonly statusEndpoint: string;
}

class HttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class BrowserMcpBridge {
  readonly #adminAuth: AdminAuthenticator;
  readonly #adminToken: string;
  readonly #broker: InvocationBroker;
  readonly #browser: BrowserGateway;
  readonly #config: BridgeConfig;
  readonly #logger: RingLogger;
  readonly #mcp: McpEndpoint;
  readonly #mcpToken: string;
  readonly #mcpVerifier: SecretVerifier;
  readonly #origins: AllowedOrigins;
  readonly #recent = new RecentRequestStore();
  readonly #registry: CapabilityRegistry;
  readonly #server: LocalServer;
  #activeHttpRequests = 0;
  #address?: BridgeAddress;

  public constructor(config: BridgeConfig, logSink?: (entry: LogEntry) => void) {
    const normalizedConfig = normalizeBridgeConfig(config);
    this.#config = normalizedConfig;
    this.#adminToken = normalizedConfig.adminBearerToken ?? createSecret("admin");
    this.#mcpToken = normalizedConfig.mcpBearerToken ?? createSecret("mcp");
    if (!/^bmp_admin_[A-Za-z0-9_-]{43,246}$/.test(this.#adminToken)) {
      throw new Error("adminBearerToken must be a high-entropy BrowserMCP admin token");
    }
    if (!/^bmp_mcp_[A-Za-z0-9_-]{43,248}$/.test(this.#mcpToken)) {
      throw new Error("mcpBearerToken must be a high-entropy BrowserMCP MCP token");
    }
    this.#adminAuth = new AdminAuthenticator(
      this.#adminToken,
      normalizedConfig.limits.uiSessionTtlMs,
    );
    this.#mcpVerifier = new SecretVerifier(this.#mcpToken);
    this.#logger = new RingLogger(200, logSink);
    this.#origins = new AllowedOrigins(normalizedConfig.allowedOrigins);
    this.#registry = new CapabilityRegistry(normalizedConfig.limits);

    let gateway: BrowserGateway | undefined;
    this.#broker = new InvocationBroker({
      limits: normalizedConfig.limits,
      logger: this.#logger,
      recent: this.#recent,
      sender: {
        send: (connectionId, message) => gateway?.send(connectionId, message) ?? false,
      },
    });
    gateway = new BrowserGateway({
      broker: this.#broker,
      limits: normalizedConfig.limits,
      logger: this.#logger,
      origins: this.#origins,
      registry: this.#registry,
    });
    this.#browser = gateway;
    this.#mcp = new McpEndpoint({
      broker: this.#broker,
      logger: this.#logger,
      maxSubscriptions: normalizedConfig.limits.maxMcpSubscriptions,
      registry: this.#registry,
    });

    const handler = (request: IncomingMessage, response: ServerResponse) => {
      void this.handleHttp(request, response).catch((error: unknown) => {
        this.handleHttpError(response, error);
      });
    };
    this.#server = normalizedConfig.tls
      ? createHttpsServer(
          {
            cert: readFileSync(normalizedConfig.tls.certPath),
            key: readFileSync(normalizedConfig.tls.keyPath),
            minVersion: "TLSv1.2",
          },
          handler,
        )
      : createHttpServer(handler);
    configureHttpServer(this.#server, normalizedConfig.limits);
    this.#server.on("upgrade", (request, socket, head) =>
      this.handleUpgrade(request, socket, head),
    );
    this.#server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
  }

  public async start(): Promise<BridgeAddress> {
    if (this.#address) return this.#address;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server.off("error", onError);
        resolve();
      };
      this.#server.once("error", onError);
      this.#server.once("listening", onListening);
      this.#server.listen(this.#config.port, this.#config.host);
    });
    const address = this.#server.address() as AddressInfo;
    const transportHost = this.#config.host;
    const httpScheme = this.#config.tls ? "https" : "http";
    const wsScheme = this.#config.tls ? "wss" : "ws";
    this.#address = {
      adminToken: this.#adminToken,
      browserEndpoint: `${wsScheme}://${transportHost}:${address.port}/browser`,
      host: this.#config.host,
      mcpEndpoint: `${httpScheme}://${transportHost}:${address.port}/mcp`,
      mcpToken: this.#mcpToken,
      port: address.port,
      statusEndpoint: `${httpScheme}://${transportHost}:${address.port}/`,
    };
    this.#logger.info("BrowserMCP Bridge started", {
      browserEndpoint: this.#address.browserEndpoint,
      host: this.#address.host,
      mcpEndpoint: this.#address.mcpEndpoint,
      tls: Boolean(this.#config.tls),
    });
    return this.#address;
  }

  public async close(): Promise<void> {
    this.#broker.close();
    await Promise.allSettled([this.#browser.close(), this.#mcp.close()]);
    if (this.#server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.#server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    this.#address = undefined;
  }

  public issuePairingToken(origin: string): { expiresAt: number; origin: string; token: string } {
    return this.#browser.issuePairingToken(origin);
  }

  public get state(): Readonly<Record<string, unknown>> {
    return this.stateSnapshot();
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.securityHeaders(response);
    if (!this.validHost(request.headers.host)) throw new HttpError(421, "Misdirected Request");
    if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
      throw new HttpError(400, "Origin-form request target required");
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.search) throw new HttpError(400, "Query parameters are not accepted");

    if (url.pathname === "/health") {
      this.handleHealth(request, response);
      return;
    }
    if (request.method === "OPTIONS") throw new HttpError(403, "CORS is not enabled here");
    if (url.pathname === "/mcp") {
      await this.handleMcp(request, response);
      return;
    }
    if (url.pathname === "/api/ui-session" && request.method === "POST") {
      this.requireSelfOrigin(request);
      if (!this.#adminAuth.verifyBearer(request.headers.authorization)) {
        throw new HttpError(401, "Unauthorized");
      }
      const session = this.#adminAuth.createSession();
      response.writeHead(204, {
        "cache-control": "no-store",
        "set-cookie": `${UI_COOKIE}=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.#config.limits.uiSessionTtlMs / 1000)}${this.#config.tls ? "; Secure" : ""}`,
      });
      response.end();
      return;
    }
    if (url.pathname === "/api/state" && request.method === "GET") {
      this.requireSelfOrigin(request);
      this.requireAdmin(request);
      this.sendJson(response, 200, this.stateSnapshot());
      return;
    }
    const approvalMatch = /^\/api\/pairing-requests\/([A-Za-z0-9-]{1,128})$/u.exec(url.pathname);
    if (approvalMatch !== null && request.method === "POST") {
      this.requireSelfOrigin(request);
      this.requireAdminMutation(request);
      const body = await this.readJsonBody(request);
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !["approve", "reject"].includes((body as { decision?: string }).decision ?? "")
      ) {
        throw new HttpError(400, "Decision must be exactly 'approve' or 'reject'");
      }
      const decided = this.#browser.decidePairingApproval(
        approvalMatch[1] ?? "",
        (body as { decision: "approve" | "reject" }).decision,
      );
      if (!decided) throw new HttpError(404, "Pairing request is no longer pending");
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/api/pairing-tokens" && request.method === "POST") {
      this.requireSelfOrigin(request);
      this.requireAdminMutation(request);
      const body = await this.readJsonBody(request);
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as { origin?: unknown }).origin !== "string"
      ) {
        throw new HttpError(400, "A valid origin is required");
      }
      let grant: ReturnType<BrowserGateway["issuePairingToken"]>;
      try {
        grant = this.#browser.issuePairingToken((body as { origin: string }).origin);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Invalid origin");
      }
      this.sendJson(response, 201, grant);
      return;
    }
    if (url.pathname === "/" && request.method === "GET") {
      const nonce = randomBytes(18).toString("base64url");
      const authenticated = this.isAdmin(request);
      const sessionToken = parseCookies(request.headers.cookie).get(UI_COOKIE);
      const csrfToken = this.#adminAuth.csrfToken(sessionToken);
      response.setHeader(
        "content-security-policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      );
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderStateUi(nonce, authenticated, csrfToken));
      return;
    }
    throw new HttpError(404, "Not Found");
  }

  private async handleMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.origin)
      throw new HttpError(403, "Browser-originated MCP requests are denied");
    if (!this.#mcpVerifier.verify(bearerToken(request.headers.authorization))) {
      response.setHeader("www-authenticate", 'Bearer realm="BrowserMCP MCP"');
      throw new HttpError(401, "Unauthorized");
    }
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      throw new HttpError(405, "Method Not Allowed");
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > this.#config.limits.maxHttpBodyBytes) {
      throw new HttpError(413, "Payload Too Large");
    }
    const body = await this.readJsonBody(request);
    const countsTowardConcurrency =
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("method" in body) ||
      body.method !== "subscriptions/listen";
    if (
      countsTowardConcurrency &&
      this.#activeHttpRequests >= this.#config.limits.maxConcurrentRequests
    ) {
      throw new HttpError(429, "Concurrent request limit reached");
    }
    if (countsTowardConcurrency) this.#activeHttpRequests += 1;
    try {
      await this.#mcp.handle(request, response, body);
    } finally {
      if (countsTowardConcurrency) this.#activeHttpRequests -= 1;
    }
  }

  private handleHealth(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin;
    if (origin !== undefined) {
      const normalizedOrigin = normalizeWebOrigin(origin);
      if (!normalizedOrigin) throw new HttpError(403, "Origin not eligible");
      response.setHeader("access-control-allow-origin", normalizedOrigin);
      response.setHeader("access-control-allow-private-network", "true");
      response.setHeader("vary", "Origin, Access-Control-Request-Private-Network");
    }
    if (request.method === "OPTIONS") {
      if (!origin) throw new HttpError(403, "Origin required");
      response.writeHead(204, {
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "GET") throw new HttpError(405, "Method Not Allowed");
    this.sendJson(response, 200, { status: "ok" });
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.validHost(request.headers.host)) {
      socket.end("HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n");
      return;
    }
    this.#browser.handleUpgrade(request, socket, head);
  }

  private validHost(host: string | undefined): boolean {
    if (!host || !this.#address) return false;
    return host === `127.0.0.1:${this.#address.port}` || host === `localhost:${this.#address.port}`;
  }

  private requireSelfOrigin(request: IncomingMessage): void {
    const origin = request.headers.origin;
    if (!origin) return;
    if (!this.#address) throw new HttpError(503, "Bridge is starting");
    const allowed = new Set([
      this.#address.statusEndpoint.slice(0, -1),
      `${this.#config.tls ? "https" : "http"}://127.0.0.1:${this.#address.port}`,
      `${this.#config.tls ? "https" : "http"}://localhost:${this.#address.port}`,
    ]);
    if (!allowed.has(origin)) throw new HttpError(403, "Origin not allowed");
  }

  private isAdmin(request: IncomingMessage): boolean {
    if (this.#adminAuth.verifyBearer(request.headers.authorization)) return true;
    return this.#adminAuth.verifySession(parseCookies(request.headers.cookie).get(UI_COOKIE));
  }

  private requireAdmin(request: IncomingMessage): void {
    if (!this.isAdmin(request)) throw new HttpError(401, "Unauthorized");
  }

  private requireAdminMutation(request: IncomingMessage): void {
    if (this.#adminAuth.verifyBearer(request.headers.authorization)) return;
    const sessionToken = parseCookies(request.headers.cookie).get(UI_COOKIE);
    const csrfHeader = request.headers["x-browsermcp-csrf"];
    const csrfToken = typeof csrfHeader === "string" ? csrfHeader : undefined;
    if (!this.#adminAuth.verifySession(sessionToken)) throw new HttpError(401, "Unauthorized");
    if (!this.#adminAuth.verifyCsrf(sessionToken, csrfToken)) {
      throw new HttpError(403, "Invalid CSRF token");
    }
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    let total = 0;
    const chunks: Buffer[] = [];
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      total += chunk.byteLength;
      if (total > this.#config.limits.maxHttpBodyBytes) {
        throw new HttpError(413, "Payload Too Large");
      }
      chunks.push(chunk);
    }
    if (chunks.length === 0) return undefined;
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "Invalid JSON");
    }
  }

  private stateSnapshot(): Readonly<Record<string, unknown>> {
    const snapshot = this.#registry.snapshot();
    return redact({
      running: Boolean(this.#address),
      mcpEndpoint: this.#address?.mcpEndpoint,
      browserEndpoint: this.#address?.browserEndpoint,
      tls: Boolean(this.#config.tls),
      apps: snapshot.sessions.map((session) => ({
        id: session.app.id,
        name: session.app.name,
        version: session.app.version,
        origin: session.origin,
        runtimeId: session.runtime.id,
        instanceId: session.runtime.instanceId,
        connectedAt: session.connectedAt,
      })),
      capabilities: {
        tools: snapshot.tools.map((item) => item.exposedName),
        resources: snapshot.resources.map((item) => item.exposedUri),
        prompts: snapshot.prompts.map((item) => item.exposedName),
      },
      registryUsage: this.#registry.usage,
      recentRequests: this.#recent.recent(),
      logs: this.#logger.recent(),
      limits: this.#config.limits,
      allowedOrigins: this.#origins.values(),
      pairingRequests: this.#browser.pendingApprovals(),
      sessions: { browser: this.#browser.connectionCount },
      mcp: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        stateless: true,
        activeRequests: this.#activeHttpRequests,
        subscriptions: this.#mcp.subscriptionCount,
      },
    }) as Readonly<Record<string, unknown>>;
  }

  private securityHeaders(response: ServerResponse): void {
    response.setHeader("cache-control", "no-store");
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
  }

  private sendJson(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
  }

  private handleHttpError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (status >= 500) this.#logger.error("HTTP request failed", { message });
    this.sendJson(response, status, {
      error: status >= 500 ? "Internal Server Error" : message,
    });
  }
}
