import {
  BrowserMCP,
  BrowserMCPError,
  type BrowserMCPSnapshot,
  type ExecutionRecord,
  prepareLocalNetworkAccess,
  validateBridgeUrl,
} from "@browsermcp/web";
import { connectionDiagnostics } from "../runtime/bridge-config.js";
import type { SitePageSnapshot } from "./capabilities.js";
import type { ConnectionViewModel, SiteConnectionController } from "./controller-types.js";
import { registerSiteCapabilities, type SiteRegistration } from "./registration.js";

const safeError = (error: unknown): { readonly code: string; readonly message: string } => {
  if (error instanceof BrowserMCPError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "SITE_CONNECTION_ERROR", message: error.message };
  return { code: "SITE_CONNECTION_ERROR", message: "Unknown BrowserMCP connection error." };
};

export const safeRuntimeSnapshot = (
  page: Pick<URL, "origin" | "pathname">,
  environment: {
    readonly language: string;
    readonly online: boolean;
    readonly userAgent: string;
    readonly secureContext: boolean;
    readonly worker: boolean;
    readonly indexedDb: boolean;
    readonly webAssembly: boolean;
  },
) => ({
  origin: page.origin,
  pathname: page.pathname,
  ...environment,
});

const runtimeSnapshot = () =>
  safeRuntimeSnapshot(new URL(location.href), {
    language: navigator.language,
    online: navigator.onLine,
    userAgent: navigator.userAgent,
    secureContext: globalThis.isSecureContext,
    worker: typeof Worker === "function",
    indexedDb: typeof indexedDB !== "undefined",
    webAssembly: typeof WebAssembly === "object",
  });

export const summarizeLatestExecution = (
  executions: readonly ExecutionRecord[],
): string | undefined => {
  const latest = executions[0];
  if (latest === undefined) return undefined;
  return latest.status === "success"
    ? `${latest.kind} ${latest.name} completed${latest.durationMs === undefined ? "" : ` in ${latest.durationMs} ms`}.`
    : `${latest.kind} ${latest.name}: ${latest.status}${latest.error === undefined ? "" : ` — ${latest.error.message}`}`;
};

export class BrowserMcpSiteController implements SiteConnectionController {
  readonly #getPageSnapshot: () => SitePageSnapshot;
  readonly #listeners = new Set<(model: ConnectionViewModel) => void>();
  #app!: BrowserMCP;
  #registration!: SiteRegistration;
  #unsubscribeApp: (() => void) | undefined;
  #snapshot!: BrowserMCPSnapshot;
  #bridgeUrl: string;
  #health: ConnectionViewModel["health"] = "unchecked";
  #healthMessage: string | undefined;
  #operationError: ConnectionViewModel["lastError"];

  public constructor(bridgeUrl: string, getPageSnapshot: () => SitePageSnapshot) {
    this.#bridgeUrl = bridgeUrl;
    this.#getPageSnapshot = getPageSnapshot;
    this.#createRuntime(bridgeUrl);
  }

  public getViewModel(): ConnectionViewModel {
    const rawLogs = this.#app.getLogs();
    const lastResult = summarizeLatestExecution(this.#snapshot.recentExecutions);
    return {
      bridgeUrl: this.#bridgeUrl,
      connectionState: this.#snapshot.connectionState,
      ...(this.#snapshot.approval === undefined
        ? {}
        : { approval: { ...this.#snapshot.approval } }),
      sessionState:
        this.#snapshot.session === undefined
          ? "none"
          : this.#snapshot.connectionState === "connected"
            ? "active"
            : "resume-available",
      ...(this.#snapshot.session === undefined ? {} : { sessionId: this.#snapshot.session.id }),
      registrations: this.#snapshot.registrations.map((registration) => ({
        kind: registration.kind,
        name: registration.name,
        status: registration.status,
      })),
      recentExecutions: this.#snapshot.recentExecutions.map((execution) => ({
        name: execution.name,
        kind: execution.kind,
        status: execution.status,
        ...(execution.durationMs === undefined ? {} : { durationMs: execution.durationMs }),
        startedAt: execution.startedAt,
        ...(execution.error === undefined
          ? {}
          : { error: `${execution.error.code}: ${execution.error.message}` }),
      })),
      ...(lastResult === undefined ? {} : { lastResult }),
      ...((this.#operationError ?? this.#snapshot.lastError) === undefined
        ? {}
        : { lastError: this.#operationError ?? this.#snapshot.lastError }),
      logs: rawLogs.map((entry) => ({
        timestamp: entry.timestamp,
        level: entry.level,
        event: entry.event,
      })),
      health: this.#health,
      ...(this.#healthMessage === undefined ? {} : { healthMessage: this.#healthMessage }),
      diagnostics: connectionDiagnostics(this.#bridgeUrl, new URL(location.href)),
    };
  }

  public subscribe(listener: (model: ConnectionViewModel) => void): () => void {
    this.#listeners.add(listener);
    listener(this.getViewModel());
    return () => this.#listeners.delete(listener);
  }

  public async connect(bridgeUrl: string): Promise<void> {
    try {
      if (bridgeUrl.length > 2_048) throw new Error("The Bridge URL is too long.");
      const validated = validateBridgeUrl(bridgeUrl, location.origin).toString();
      if (validated !== this.#bridgeUrl) await this.#replaceRuntime(validated);
      this.#operationError = undefined;
      await this.checkHealth(validated);
      await this.#app.connect({ requestApproval: true, prepareLocalNetworkAccess: false });
    } catch (error) {
      this.#operationError = safeError(error);
      this.#emit();
    }
  }

  public async reconnect(): Promise<void> {
    try {
      this.#operationError = undefined;
      if (this.#app.bridgeUrl !== this.#bridgeUrl) {
        throw new Error("The Bridge URL changed. Request approval for the new endpoint.");
      }
      await this.checkHealth(this.#bridgeUrl);
      await this.#app.reconnect();
    } catch (error) {
      this.#operationError = safeError(error);
      this.#emit();
    }
  }

  public async disconnect(): Promise<void> {
    try {
      this.#operationError = undefined;
      await this.#app.disconnect({ reason: "Disconnected from the BrowserMCP site UI" });
    } catch (error) {
      this.#operationError = safeError(error);
      this.#emit();
    }
  }

  public async checkHealth(bridgeUrl: string): Promise<void> {
    let validated: string;
    try {
      if (bridgeUrl.length > 2_048) throw new Error("The Bridge URL is too long.");
      validated = validateBridgeUrl(bridgeUrl, location.origin).toString();
    } catch (error) {
      this.#health = "failed";
      this.#healthMessage = safeError(error).message;
      this.#emit();
      throw error;
    }
    this.#bridgeUrl = validated;
    this.#health = "checking";
    this.#healthMessage = undefined;
    this.#emit();
    try {
      const result = await prepareLocalNetworkAccess(validated, {
        timeoutMs: 5_000,
        pageOrigin: location.origin,
      });
      this.#health = "reachable";
      this.#healthMessage = `HTTP ${result.status} · ${result.url}`;
    } catch (error) {
      this.#health = "failed";
      this.#healthMessage = safeError(error).message;
      throw error;
    } finally {
      this.#emit();
    }
  }

  public async destroy(): Promise<void> {
    this.#unsubscribeApp?.();
    this.#unsubscribeApp = undefined;
    await this.#app.disconnect({ reason: "Site runtime destroyed" }).catch(() => undefined);
    await this.#registration.unregister().catch(() => undefined);
    this.#listeners.clear();
  }

  #createRuntime(bridgeUrl: string): void {
    this.#app = new BrowserMCP({
      appId: "app:browsermcp-site",
      name: "BrowserMCP Site",
      version: "0.1.0",
      bridgeUrl,
      reconnect: { maxAttempts: 6, initialDelayMs: 400, maxDelayMs: 10_000, factor: 1.8 },
      invocationTimeoutMs: 30_000,
      maxRecentExecutions: 50,
      maxLogEntries: 200,
    });
    this.#snapshot = this.#app.getSnapshot();
    this.#registration = registerSiteCapabilities(this.#app, {
      getPageSnapshot: this.#getPageSnapshot,
      getRuntimeSnapshot: runtimeSnapshot,
      getConnectionSnapshot: () => this.#app.getSnapshot(),
      getRegistrationSnapshot: () => this.#app.getRegistrations(),
    });
    void this.#registration.ready.catch(() => undefined);
    this.#unsubscribeApp = this.#app.subscribe((snapshot) => {
      this.#snapshot = snapshot;
      this.#emit();
    });
  }

  async #replaceRuntime(bridgeUrl: string): Promise<void> {
    this.#unsubscribeApp?.();
    await this.#app.disconnect({ reason: "Bridge URL changed" }).catch(() => undefined);
    await this.#registration.unregister().catch(() => undefined);
    this.#bridgeUrl = bridgeUrl;
    this.#health = "unchecked";
    this.#healthMessage = undefined;
    this.#createRuntime(bridgeUrl);
  }

  #emit(): void {
    const model = this.getViewModel();
    for (const listener of this.#listeners) listener(model);
  }
}
