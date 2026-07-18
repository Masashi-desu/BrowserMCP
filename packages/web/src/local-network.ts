import { BrowserMCPError } from "./errors.js";
import type { LocalNetworkAccessOptions, LocalNetworkAccessResult } from "./types.js";

export const DEFAULT_BRIDGE_URL = "wss://127.0.0.1:8789/browser";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

function pageSecurity(pageOrigin: string | undefined): { readonly secure: boolean } {
  if (pageOrigin === undefined) return { secure: globalThis.isSecureContext === true };
  let page: URL;
  try {
    page = new URL(pageOrigin);
  } catch {
    throw new BrowserMCPError("INVALID_CONFIGURATION", "Page origin must be an absolute URL");
  }
  if (
    (page.protocol !== "http:" && page.protocol !== "https:") ||
    page.origin !== pageOrigin ||
    page.username !== "" ||
    page.password !== ""
  ) {
    throw new BrowserMCPError(
      "INVALID_CONFIGURATION",
      "Page origin must be an exact http(s) Origin without a path or credentials",
    );
  }
  if (page.protocol === "http:" && !LOOPBACK_HOSTS.has(page.hostname.toLowerCase())) {
    throw new BrowserMCPError(
      "INSECURE_BRIDGE_URL",
      "A non-loopback BrowserMCP page must use HTTPS before connecting to the local Bridge",
    );
  }
  return { secure: page.protocol === "https:" };
}

export function validateBridgeUrl(value: string, pageOrigin = globalThis.location?.origin): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new BrowserMCPError("INVALID_BRIDGE_URL", "Bridge URL must be an absolute URL", {
      cause,
    });
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new BrowserMCPError("INVALID_BRIDGE_URL", "Bridge URL must use the ws: or wss: scheme");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new BrowserMCPError(
      "INVALID_BRIDGE_URL",
      "BrowserMCP only connects to localhost or 127.0.0.1; the Bridge is IPv4-only",
    );
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new BrowserMCPError(
      "INVALID_BRIDGE_URL",
      "Bridge URL must not contain credentials, query parameters, or a fragment",
    );
  }
  if (url.pathname !== "/browser") {
    throw new BrowserMCPError("INVALID_BRIDGE_URL", "Bridge WebSocket path must be /browser");
  }

  const securePage = pageSecurity(pageOrigin).secure;
  if (securePage && url.protocol === "ws:") {
    throw new BrowserMCPError(
      "INSECURE_BRIDGE_URL",
      "An HTTPS page cannot connect to an insecure ws: bridge. Configure a trusted wss: loopback endpoint.",
    );
  }
  return url;
}

export function deriveHealthUrl(bridgeUrl: string, pageOrigin?: string): string {
  const parsed = validateBridgeUrl(bridgeUrl, pageOrigin);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/health";
  return parsed.toString();
}

function validateHealthUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new BrowserMCPError("INVALID_BRIDGE_URL", "Local network health URL must be absolute", {
      cause,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserMCPError(
      "INVALID_BRIDGE_URL",
      "Local network health URL must use http: or https:",
    );
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new BrowserMCPError(
      "INVALID_BRIDGE_URL",
      "Local network health check must target a loopback host",
    );
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new BrowserMCPError(
      "INVALID_BRIDGE_URL",
      "Local network health URL must not contain credentials, query parameters, or a fragment",
    );
  }
  return url;
}

interface LoopbackRequestInit extends RequestInit {
  targetAddressSpace: "loopback";
}

/**
 * Performs a credential-free health request before the WebSocket handshake.
 * Chromium can use it to surface Local Network Access permission; other browsers
 * safely ignore the targetAddressSpace extension.
 */
export async function prepareLocalNetworkAccess(
  bridgeUrl = DEFAULT_BRIDGE_URL,
  options: LocalNetworkAccessOptions = {},
): Promise<LocalNetworkAccessResult> {
  validateBridgeUrl(bridgeUrl, options.pageOrigin);
  const healthUrl = validateHealthUrl(
    options.healthUrl ?? deriveHealthUrl(bridgeUrl, options.pageOrigin),
  );
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new BrowserMCPError(
      "LOCAL_NETWORK_ACCESS_FAILED",
      "fetch is unavailable; Local Network Access cannot be prepared",
    );
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new BrowserMCPError(
      "INVALID_CONFIGURATION",
      "Local Network Access timeout must be a positive integer",
    );
  }

  const controller = new AbortController();
  const onAbort = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted === true) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort("Local Network Access timeout"), timeoutMs);

  try {
    const request: LoopbackRequestInit = {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      targetAddressSpace: "loopback",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    };
    const response = await fetcher(healthUrl, request);
    if (!response.ok) {
      throw new BrowserMCPError(
        "LOCAL_NETWORK_ACCESS_FAILED",
        `Bridge health check returned HTTP ${response.status}`,
        { retryable: response.status >= 500 },
      );
    }
    return { url: healthUrl.toString(), status: response.status };
  } catch (cause) {
    if (cause instanceof BrowserMCPError) throw cause;
    const hint =
      healthUrl.protocol === "https:"
        ? "Allow Local Network Access and trust the Bridge loopback certificate, then retry."
        : "Allow Local Network Access and ensure the local Bridge is running, then retry.";
    throw new BrowserMCPError(
      "LOCAL_NETWORK_ACCESS_FAILED",
      `Could not reach the BrowserMCP Bridge health endpoint. ${hint}`,
      { cause, retryable: true },
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
